const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  readUploadCleanupConfig,
  runUploadCleanup,
  runUploadCleanupFromEnvironment,
  runUploadCleanupStartup,
} = require('../upload-cleanup');

const SECRET_KEY = 'sb_secret_unit_test_key_not_real';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validClaim(overrides = {}) {
  const sessionId = overrides.session_id || SESSION_ID;
  return {
    session_id: sessionId,
    bucket_id: 'smart-job-company-files',
    object_paths: [
      `${COMPANY_ID}/${USER_ID}/${sessionId}/${ATTACHMENT_ID}.jpg`,
    ],
    lease_expires_at: '2026-07-13T12:05:00.000Z',
    attempt_count: 1,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    supabaseOrigin: 'https://project-ref.supabase.co',
    secretKey: SECRET_KEY,
    batchSize: 25,
    leaseSeconds: 300,
    concurrency: 2,
    timeoutMs: 10_000,
    ...overrides,
  };
}

function pathname(input) {
  return new URL(String(input)).pathname;
}

describe('abandoned upload cleanup worker', () => {
  it('uses the secret only as apikey and deletes exactly the claimed manifest', async () => {
    const calls = [];
    const fetchImpl = async (input, init) => {
      calls.push({ input, init });
      const path = pathname(input);
      if (path.endsWith('/queue_expired_file_upload_cleanup')) {
        return jsonResponse({ uploadSessionsQueued: 1, uploadSessionsQuarantined: 0 });
      }
      if (path.endsWith('/claim_file_upload_cleanup_batch')) {
        return jsonResponse([validClaim()]);
      }
      if (path === '/storage/v1/object/smart-job-company-files') {
        return jsonResponse([{ name: validClaim().object_paths[0] }]);
      }
      if (path.endsWith('/finish_file_upload_cleanup')) {
        return jsonResponse({ outcome: 'cleanup_complete', status: 'cleanup_complete' });
      }
      throw new Error(`unexpected request ${path}`);
    };

    const summary = await runUploadCleanup(config(), fetchImpl);
    assert.equal(summary.completed, 1);
    assert.equal(summary.failures.length, 0);
    assert.equal(calls.length, 4);

    for (const call of calls) {
      assert.equal(call.init.headers.apikey, SECRET_KEY);
      assert.equal(
        Object.keys(call.init.headers).some((name) => name.toLowerCase() === 'authorization'),
        false,
        'opaque Supabase secret keys must never be sent as bearer tokens',
      );
    }

    const storageCall = calls.find((call) => call.init.method === 'DELETE');
    assert.ok(storageCall);
    assert.deepEqual(JSON.parse(storageCall.init.body), {
      prefixes: validClaim().object_paths,
    });
    const finishCall = calls.find((call) => pathname(call.input).endsWith('/finish_file_upload_cleanup'));
    assert.deepEqual(JSON.parse(finishCall.init.body), {
      p_session_id: SESSION_ID,
      p_attempt_count: 1,
      p_succeeded: true,
      p_error: null,
    });
  });

  it('rejects a cross-prefix claim before Storage and safely requeues it', async () => {
    const calls = [];
    const crossPrefix = validClaim({
      object_paths: [
        `${COMPANY_ID}/${USER_ID}/55555555-5555-4555-8555-555555555555/${ATTACHMENT_ID}.jpg`,
      ],
    });
    const fetchImpl = async (input, init) => {
      calls.push({ input, init });
      const path = pathname(input);
      if (path.endsWith('/queue_expired_file_upload_cleanup')) return jsonResponse({});
      if (path.endsWith('/claim_file_upload_cleanup_batch')) return jsonResponse([crossPrefix]);
      if (path.endsWith('/finish_file_upload_cleanup')) {
        const body = JSON.parse(init.body);
        assert.equal(body.p_succeeded, false);
        assert.match(body.p_error, /non-canonical/);
        return jsonResponse({ outcome: 'cleanup_pending', status: 'cleanup_pending' });
      }
      throw new Error(`Storage DELETE must not run for ${path}`);
    };

    const summary = await runUploadCleanup(config(), fetchImpl);
    assert.equal(summary.requeued, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].stage, 'validation');
    assert.equal(calls.some((call) => call.init.method === 'DELETE'), false);
  });

  it('reports Storage failures after acknowledging a bounded retry', async () => {
    const fetchImpl = async (input, init) => {
      const path = pathname(input);
      if (path.endsWith('/queue_expired_file_upload_cleanup')) return jsonResponse({});
      if (path.endsWith('/claim_file_upload_cleanup_batch')) return jsonResponse([validClaim()]);
      if (path === '/storage/v1/object/smart-job-company-files') {
        return jsonResponse({ message: 'temporary failure' }, 503);
      }
      if (path.endsWith('/finish_file_upload_cleanup')) {
        const body = JSON.parse(init.body);
        assert.equal(body.p_succeeded, false);
        assert.match(body.p_error, /HTTP 503/);
        return jsonResponse({ outcome: 'cleanup_pending', status: 'cleanup_pending' });
      }
      throw new Error(`unexpected request ${path}`);
    };

    const summary = await runUploadCleanup(config(), fetchImpl);
    assert.equal(summary.completed, 0);
    assert.equal(summary.requeued, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].stage, 'delete');
  });

  it('keeps object deletion concurrency within the configured bound', async () => {
    const claims = Array.from({ length: 5 }, (_, index) => {
      const suffix = String(index + 10).padStart(12, '0');
      const sessionId = `00000000-0000-4000-8000-${suffix}`;
      const attachmentId = `00000000-0000-4000-9000-${suffix}`;
      return validClaim({
        session_id: sessionId,
        object_paths: [`${COMPANY_ID}/${USER_ID}/${sessionId}/${attachmentId}.jpg`],
      });
    });
    let activeDeletes = 0;
    let maximumActiveDeletes = 0;
    const fetchImpl = async (input) => {
      const path = pathname(input);
      if (path.endsWith('/queue_expired_file_upload_cleanup')) return jsonResponse({});
      if (path.endsWith('/claim_file_upload_cleanup_batch')) return jsonResponse(claims);
      if (path === '/storage/v1/object/smart-job-company-files') {
        activeDeletes += 1;
        maximumActiveDeletes = Math.max(maximumActiveDeletes, activeDeletes);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeDeletes -= 1;
        return jsonResponse([]);
      }
      if (path.endsWith('/finish_file_upload_cleanup')) {
        return jsonResponse({ outcome: 'cleanup_complete', status: 'cleanup_complete' });
      }
      throw new Error(`unexpected request ${path}`);
    };

    const summary = await runUploadCleanup(config({ concurrency: 2 }), fetchImpl);
    assert.equal(summary.completed, 5);
    assert.ok(maximumActiveDeletes <= 2);
  });

  it('skips cleanly when startup cleanup is not configured', async () => {
    const summary = await runUploadCleanupFromEnvironment({}, async () => {
      throw new Error('fetch must not be called');
    });
    assert.equal(summary.skipped, true);
  });

  it('reports a startup failure without throwing into monthly archive work', async () => {
    const errors = [];
    const logger = {
      log() {},
      warn() {},
      error(...args) { errors.push(args); },
    };
    const result = await runUploadCleanupStartup({
      env: {
        SUPABASE_URL: 'https://project-ref.supabase.co',
        SUPABASE_SECRET_KEY: SECRET_KEY,
      },
      fetchImpl: async () => jsonResponse({ message: 'offline' }, 503),
      logger,
    });
    assert.equal(result, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /monthly archives will continue/);
  });

  it('requires an opaque server secret and an exact secure project origin', () => {
    assert.throws(
      () => readUploadCleanupConfig({
        SUPABASE_URL: 'https://project-ref.supabase.co',
        SUPABASE_SECRET_KEY: 'legacy-service-role-jwt',
      }),
      /sb_secret_/,
    );
    assert.throws(
      () => readUploadCleanupConfig({
        SUPABASE_URL: 'http://project-ref.supabase.co',
        SUPABASE_SECRET_KEY: SECRET_KEY,
      }),
      /HTTPS/,
    );
    assert.equal(
      readUploadCleanupConfig({
        SUPABASE_URL: 'http://127.0.0.1:55321',
        SUPABASE_SECRET_KEY: SECRET_KEY,
      }).supabaseOrigin,
      'http://127.0.0.1:55321',
    );
  });
});
