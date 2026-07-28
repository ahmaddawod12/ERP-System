const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  readUploadCleanupConfig,
  runUploadCleanup,
  runUploadCleanupStartup,
} = require('../upload-cleanup');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';

function validClaim(overrides = {}) {
  const sessionId = overrides.sessionId || SESSION_ID;
  return {
    sessionId,
    bucketId: 'smart-job-company-files',
    objectPaths: [
      `${COMPANY_ID}/${USER_ID}/${sessionId}/${ATTACHMENT_ID}.jpg`,
    ],
    leaseExpiresAt: '2026-07-13T12:05:00.000Z',
    attemptCount: 1,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    projectId: 'smart-job-production',
    bucketId: 'smart-job-company-files',
    batchSize: 25,
    leaseSeconds: 300,
    concurrency: 2,
    ...overrides,
  };
}

function dependencies(claims, options = {}) {
  const finishes = [];
  const deleted = [];
  return {
    finishes,
    deleted,
    value: {
      database: {
        async queue() {
          return { uploadSessionsQueued: claims.length };
        },
        async claim(limit, leaseSeconds) {
          assert.equal(limit, 25);
          assert.equal(leaseSeconds, 300);
          return claims;
        },
        async finish(input) {
          finishes.push(input);
          return {
            outcome: input.succeeded
              ? 'cleanup_complete'
              : (options.failedOutcome || 'cleanup_pending'),
          };
        },
      },
      bucket: {
        file(path) {
          return {
            async delete(input) {
              assert.deepEqual(input, { ignoreNotFound: true });
              if (options.deleteError) throw options.deleteError;
              deleted.push(path);
            },
          };
        },
      },
    },
  };
}

describe('abandoned upload cleanup worker', () => {
  it('deletes exactly the paths claimed by PostgreSQL and marks success', async () => {
    const claim = validClaim();
    const mocks = dependencies([claim]);
    const summary = await runUploadCleanup(config(), mocks.value);

    assert.equal(summary.completed, 1);
    assert.equal(summary.failures.length, 0);
    assert.deepEqual(mocks.deleted, claim.objectPaths);
    assert.deepEqual(mocks.finishes, [{
      sessionId: SESSION_ID,
      attemptCount: 1,
      succeeded: true,
      error: null,
    }]);
  });

  it('rejects a cross-prefix claim before GCS and safely requeues it', async () => {
    const crossPrefix = validClaim({
      objectPaths: [
        `${COMPANY_ID}/${USER_ID}/55555555-5555-4555-8555-555555555555/${ATTACHMENT_ID}.jpg`,
      ],
    });
    const mocks = dependencies([crossPrefix]);
    const summary = await runUploadCleanup(config(), mocks.value);

    assert.equal(summary.requeued, 1);
    assert.equal(summary.failures[0].stage, 'validation');
    assert.deepEqual(mocks.deleted, []);
    assert.equal(mocks.finishes[0].succeeded, false);
  });

  it('reports GCS deletion failures after acknowledging a bounded retry', async () => {
    const mocks = dependencies(
      [validClaim()],
      { deleteError: new Error('GCS unavailable') },
    );
    const summary = await runUploadCleanup(config(), mocks.value);

    assert.equal(summary.requeued, 1);
    assert.equal(summary.failures[0].stage, 'delete');
    assert.match(mocks.finishes[0].error, /GCS unavailable/);
  });

  it('keeps claim concurrency within the configured bound', async () => {
    const claims = Array.from({ length: 5 }, (_, index) => {
      const suffix = String(index + 10).padStart(12, '0');
      const sessionId = `00000000-0000-4000-8000-${suffix}`;
      const attachmentId = `00000000-0000-4000-9000-${suffix}`;
      return validClaim({
        sessionId,
        objectPaths: [`${COMPANY_ID}/${USER_ID}/${sessionId}/${attachmentId}.jpg`],
      });
    });
    let active = 0;
    let maximum = 0;
    const database = dependencies(claims).value.database;
    const summary = await runUploadCleanup(config({ concurrency: 2 }), {
      database,
      bucket: {
        file() {
          return {
            async delete() {
              active += 1;
              maximum = Math.max(maximum, active);
              await new Promise((resolve) => setTimeout(resolve, 5));
              active -= 1;
            },
          };
        },
      },
    });
    assert.equal(summary.completed, 5);
    assert.ok(maximum <= 2);
  });

  it('validates the canonical GCS bucket and bounded worker settings', () => {
    const parsed = readUploadCleanupConfig({
      GCS_PROJECT_ID: 'smart-job-production',
      COMPANY_FILES_BUCKET: 'smart-job-company-files',
      UPLOAD_CLEANUP_BATCH_SIZE: '50',
    });
    assert.equal(parsed.projectId, 'smart-job-production');
    assert.equal(parsed.batchSize, 50);
    assert.throws(
      () => readUploadCleanupConfig({ COMPANY_FILES_BUCKET: 'other-bucket' }),
      /smart-job-company-files/,
    );
  });

  it('reports invalid startup configuration without blocking archive work', async () => {
    const errors = [];
    const result = await runUploadCleanupStartup({
      env: {},
      logger: {
        log() {},
        warn() {},
        error(...args) { errors.push(args); },
      },
    });
    assert.equal(result, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /monthly archives will continue/);
  });
});
