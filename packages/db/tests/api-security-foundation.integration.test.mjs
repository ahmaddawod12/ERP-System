import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { after, before, describe, it, test } from 'node:test';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.SMART_JOB_DATABASE_URL || '',
).trim();

function assertLocalIntegrationDatabase() {
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const isLoopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
  assert.equal(
    isLoopback,
    true,
    'Database integration tests are destructive fixtures and only run against a loopback DATABASE_URL',
  );
}

function databaseClient() {
  const sslMode = String(
    process.env.DATABASE_SSL_MODE || process.env.SMART_JOB_DATABASE_SSL_MODE || 'disable',
  ).toLowerCase();
  const sslRejectUnauthorized = String(
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED
      || process.env.SMART_JOB_DATABASE_SSL_REJECT_UNAUTHORIZED
      || 'true',
  ).toLowerCase() !== 'false';
  const sslCa = String(
    process.env.DATABASE_SSL_CA || process.env.SMART_JOB_DATABASE_SSL_CA || '',
  ).replace(/\\n/g, '\n').trim();

  return new Client({
    connectionString: databaseUrl,
    application_name: 'smart-job-db-integration-tests',
    connectionTimeoutMillis: 10_000,
    ssl: sslMode === 'require'
      ? {
          rejectUnauthorized: sslRejectUnauthorized,
          ...(sslCa ? { ca: sslCa } : {}),
        }
      : false,
  });
}

async function withClient(work) {
  const client = databaseClient();
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function withTransaction(work) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  });
}

async function setRuntimeContext(client, userId) {
  await client.query('SET LOCAL ROLE smart_job_api');
  await client.query(
    'SELECT private.set_api_request_context($1::uuid, $2::integer, $3::integer, $4::integer)',
    [userId, 12_000, 3_000, 15_000],
  );
}

async function expectDatabaseError(promise, expectedCode, messagePattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, expectedCode);
    if (messagePattern) {
      assert.match(String(error?.message || ''), messagePattern);
    }
    return true;
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function uploadManifest(userId, sessionId) {
  return [{
    attachmentId: randomUUID(),
    kind: 'photo',
    fileName: 'fixture.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    sha256: createHash('sha256').update('fixture').digest('hex'),
    objectPath: `${userId}/${sessionId}/fixture.jpg`,
  }];
}

function canonicalApiUpload(companyId, userId, sessionId) {
  const attachmentId = randomUUID();
  const objectPrefix = `${companyId}/${userId}/${sessionId}`;
  return {
    objectPrefix,
    manifest: [{
      attachmentId,
      kind: 'photo',
      fileName: 'fixture.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      sha256: createHash('sha256').update('upload-session-fixture').digest('hex'),
      objectPath: `${objectPrefix}/${attachmentId}.jpg`,
    }],
  };
}

async function insertUploadIdempotencyClaim(client, userId, companyId, sessionId) {
  await client.query(
    `INSERT INTO private.api_idempotency (
       id, user_id, company_id, operation, idempotency_key_hash,
       request_hash, expires_at
     ) VALUES (
       $1, $2, $3, 'uploads.job_attachments.prepare', $4, $5,
       clock_timestamp() + interval '24 hours'
     )`,
    [
      sessionId,
      userId,
      companyId,
      sha256(`upload-key:${sessionId}`),
      sha256(`upload-request:${sessionId}`),
    ],
  );
}

async function prepareApiUploadSession(
  client,
  userId,
  companyId,
  sessionId,
  existingUpload,
) {
  const upload = existingUpload ?? canonicalApiUpload(companyId, userId, sessionId);
  const result = await client.query(
    `SELECT *
     FROM private.prepare_api_file_upload_session(
       $1::uuid,
       $2::uuid,
       'job.create_finished',
       NULL,
       'smart-job-company-files',
       $3,
       $4::jsonb,
       clock_timestamp() + interval '119 minutes'
     )`,
    [sessionId, companyId, upload.objectPrefix, JSON.stringify(upload.manifest)],
  );
  return { result, upload };
}

const fixture = {
  userA: randomUUID(),
  userB: randomUUID(),
  companyA: randomUUID(),
  companyB: randomUUID(),
  membershipA: randomUUID(),
  membershipB: randomUUID(),
  jobA: randomUUID(),
  concurrentJob: randomUUID(),
};

const publicCompanyBase = 8_000_000_000_000 + randomInt(1_000_000);

async function insertFixture(client) {
  await client.query(
    `INSERT INTO public.app_users (id, email, display_name)
     VALUES ($1, $2, 'API test manager A'), ($3, $4, 'API test manager B')`,
    [
      fixture.userA,
      `api-test-${fixture.userA}@example.invalid`,
      fixture.userB,
      `api-test-${fixture.userB}@example.invalid`,
    ],
  );
  await client.query(
    `INSERT INTO public.companies (
       id, public_company_id, account_type, status, created_by_user_id
     ) VALUES
       ($1, $2, 'business', 'active', $3),
       ($4, $5, 'business', 'active', $6)`,
    [
      fixture.companyA,
      publicCompanyBase,
      fixture.userA,
      fixture.companyB,
      publicCompanyBase + 1,
      fixture.userB,
    ],
  );
  await client.query(
    `INSERT INTO public.company_sync_state (company_id)
     VALUES ($1), ($2)`,
    [fixture.companyA, fixture.companyB],
  );
  await client.query(
    `INSERT INTO public.company_subscriptions (
       company_id, tier, status, enabled_modules
     ) VALUES
       ($1, 'Team', 'active', '{"jobs":true}'::jsonb),
       ($2, 'Team', 'active', '{"jobs":true}'::jsonb)`,
    [fixture.companyA, fixture.companyB],
  );
  await client.query(
    `INSERT INTO public.company_memberships (
       id, company_id, user_id, member_no, role, status, display_name
     ) VALUES
       ($1, $2, $3, 1, 'manager', 'active', 'API test manager A'),
       ($4, $5, $6, 1, 'manager', 'active', 'API test manager B')`,
    [
      fixture.membershipA,
      fixture.companyA,
      fixture.userA,
      fixture.membershipB,
      fixture.companyB,
      fixture.userB,
    ],
  );
  await client.query(
    `INSERT INTO public.jobs (
       id, company_id, job_no, status, title,
       assigned_membership_id, created_by_membership_id
     ) VALUES
       ($1, $2, 1, 'pending', 'API security fixture', $3, $3),
       ($4, $2, 2, 'waiting', 'API concurrency fixture', $3, $3)`,
    [fixture.jobA, fixture.companyA, fixture.membershipA, fixture.concurrentJob],
  );
}

async function deleteFixture(client) {
  await client.query(
    `DELETE FROM private.web_sessions
     WHERE user_id IN ($1::uuid, $2::uuid)`,
    [fixture.userA, fixture.userB],
  ).catch(() => undefined);
  await client.query(
    `DELETE FROM private.api_idempotency
     WHERE user_id IN ($1::uuid, $2::uuid)`,
    [fixture.userA, fixture.userB],
  ).catch(() => undefined);
  await client.query(
    `DELETE FROM private.file_upload_sessions
     WHERE user_id IN ($1::uuid, $2::uuid)`,
    [fixture.userA, fixture.userB],
  ).catch(() => undefined);
  await client.query(
    'DELETE FROM public.companies WHERE id IN ($1::uuid, $2::uuid)',
    [fixture.companyA, fixture.companyB],
  ).catch(() => undefined);
  await client.query(
    'DELETE FROM public.app_users WHERE id IN ($1, $2)',
    [fixture.userA, fixture.userB],
  ).catch(() => undefined);
}

async function completeJob(client, jobId, expectedVersion = 1, parts = null) {
  return client.query(
    `SELECT *
     FROM private.complete_job_with_details(
       $1::uuid,
       $2::uuid,
       $3::bigint,
       $4::jsonb,
       $5::jsonb,
       $6::uuid,
       $7::timestamptz
     )`,
    [
      fixture.companyA,
      jobId,
      expectedVersion,
      JSON.stringify({}),
      parts === null ? null : JSON.stringify(parts),
      null,
      new Date(),
    ],
  );
}

const apiCreateFixture = {
  managerUser: randomUUID(),
  soloUser: randomUUID(),
  workerUser: randomUUID(),
  otherUser: randomUUID(),
  company: randomUUID(),
  otherCompany: randomUUID(),
  managerMembership: randomUUID(),
  soloMembership: randomUUID(),
  workerMembership: randomUUID(),
  otherMembership: randomUUID(),
  client: randomUUID(),
  otherClient: randomUUID(),
  part: randomUUID(),
  otherPart: randomUUID(),
  soloLocation: randomUUID(),
};

const apiCreateCompanyNo = publicCompanyBase + 100;

async function insertApiCreateFixture(client) {
  const users = [
    [apiCreateFixture.managerUser, 'API create manager'],
    [apiCreateFixture.soloUser, 'API create solo user'],
    [apiCreateFixture.workerUser, 'API create worker'],
    [apiCreateFixture.otherUser, 'API create other manager'],
  ];
  for (const [userId, displayName] of users) {
    await client.query(
      `INSERT INTO public.app_users (id, email, display_name)
       VALUES ($1, $2, $3)`,
      [userId, `api-create-${userId}@example.invalid`, displayName],
    );
  }

  await client.query(
    `INSERT INTO public.companies (
       id, public_company_id, account_type, status, created_by_user_id
     ) VALUES
       ($1, $2, 'business', 'active', $3),
       ($4, $5, 'business', 'active', $6)`,
    [
      apiCreateFixture.company,
      apiCreateCompanyNo,
      apiCreateFixture.managerUser,
      apiCreateFixture.otherCompany,
      apiCreateCompanyNo + 1,
      apiCreateFixture.otherUser,
    ],
  );
  await client.query(
    `INSERT INTO public.company_subscriptions (
       company_id, tier, status, enabled_modules
     ) VALUES
       ($1, 'Team', 'active', '{"solojob":true,"inventory":true}'::jsonb),
       ($2, 'Team', 'active', '{"solojob":true,"inventory":true}'::jsonb)`,
    [apiCreateFixture.company, apiCreateFixture.otherCompany],
  );
  await client.query(
    `INSERT INTO public.company_sync_state (company_id)
     VALUES ($1), ($2)`,
    [apiCreateFixture.company, apiCreateFixture.otherCompany],
  );
  await client.query(
    `INSERT INTO public.company_memberships (
       id, company_id, user_id, member_no, role, status, display_name
     ) VALUES
       ($1, $2, $3, 1, 'manager', 'active', 'API create manager'),
       ($4, $2, $5, 2, 'user', 'active', 'API create solo user'),
       ($6, $2, $7, 3, 'worker', 'active', 'API create worker'),
       ($8, $9, $10, 99, 'manager', 'active', 'Other tenant manager')`,
    [
      apiCreateFixture.managerMembership,
      apiCreateFixture.company,
      apiCreateFixture.managerUser,
      apiCreateFixture.soloMembership,
      apiCreateFixture.soloUser,
      apiCreateFixture.workerMembership,
      apiCreateFixture.workerUser,
      apiCreateFixture.otherMembership,
      apiCreateFixture.otherCompany,
      apiCreateFixture.otherUser,
    ],
  );
  await client.query(
    `INSERT INTO public.clients (
       id, company_id, client_no, status, name, phone
     ) VALUES
       ($1, $2, 71, 'active', 'API create client', '+972500000071'),
       ($3, $4, 72, 'active', 'Other tenant client', '+972500000072')`,
    [
      apiCreateFixture.client,
      apiCreateFixture.company,
      apiCreateFixture.otherClient,
      apiCreateFixture.otherCompany,
    ],
  );
  await client.query(
    `INSERT INTO public.inventory_parts (
       id, company_id, part_no, name, active
     ) VALUES
       ($1, $2, 501, 'API fixture part', true),
       ($3, $4, 777, 'Other tenant part', true)`,
    [
      apiCreateFixture.part,
      apiCreateFixture.company,
      apiCreateFixture.otherPart,
      apiCreateFixture.otherCompany,
    ],
  );
  await client.query(
    `INSERT INTO public.inventory_locations (
       id, company_id, location_type, membership_id, name
     ) VALUES ($1, $2, 'member', $3, 'Solo inventory')`,
    [
      apiCreateFixture.soloLocation,
      apiCreateFixture.company,
      apiCreateFixture.soloMembership,
    ],
  );
  await client.query(
    `INSERT INTO public.inventory_balances (
       location_id, part_id, quantity_on_hand
     ) VALUES ($1, $2, 10)`,
    [apiCreateFixture.soloLocation, apiCreateFixture.part],
  );
}

async function deleteApiCreateFixture(client) {
  await client.query(
    `DELETE FROM storage.objects
     WHERE name LIKE $1`,
    [`api-job-create/${apiCreateFixture.company}/%`],
  ).catch(() => undefined);
  await client.query(
    `DELETE FROM private.file_upload_sessions
     WHERE user_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [
      apiCreateFixture.managerUser,
      apiCreateFixture.soloUser,
      apiCreateFixture.workerUser,
      apiCreateFixture.otherUser,
    ],
  ).catch(() => undefined);
  await client.query(
    `DELETE FROM public.companies WHERE id IN ($1::uuid, $2::uuid)`,
    [apiCreateFixture.company, apiCreateFixture.otherCompany],
  ).catch(() => undefined);
  await client.query(
    `DELETE FROM public.app_users WHERE id IN ($1, $2, $3, $4)`,
    [
      apiCreateFixture.managerUser,
      apiCreateFixture.soloUser,
      apiCreateFixture.workerUser,
      apiCreateFixture.otherUser,
    ],
  ).catch(() => undefined);
}

async function createApiJob(client, options = {}) {
  return client.query(
    `SELECT *
     FROM private.create_api_job_with_details(
       $1::uuid,
       $2::public.job_status,
       $3::text,
       $4::text,
       $5::text,
       $6::text,
       $7::integer,
       $8::jsonb,
       $9::jsonb,
       $10::uuid,
       $11::timestamptz
     )`,
    [
      options.companyId ?? apiCreateFixture.company,
      options.status ?? 'pending',
      options.title ?? 'API-created job',
      options.description ?? 'Created by the Node API integration fixture',
      options.location ?? null,
      options.clientId ?? null,
      options.assigneeMemberNo ?? null,
      JSON.stringify(options.details ?? {}),
      JSON.stringify(options.parts ?? []),
      options.uploadSessionId ?? null,
      options.createdAt ?? new Date(),
    ],
  );
}

function createApiUploadManifest(sessionId, overrides = {}) {
  const objectPrefix = `api-job-create/${apiCreateFixture.company}/${apiCreateFixture.soloUser}/${sessionId}`;
  const objectPath = `${objectPrefix}/fixture.jpg`;
  const sha = createHash('sha256').update('api-create-fixture').digest('hex');
  return {
    objectPrefix,
    objectPath,
    manifest: [{
      attachmentId: randomUUID(),
      kind: 'photo',
      fileName: 'fixture.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      sha256: sha,
      objectPath,
      ...overrides,
    }],
  };
}

async function insertApiUploadSession(client, sessionId, upload, options = {}) {
  await client.query(
    `INSERT INTO private.file_upload_sessions (
       id, user_id, company_id, purpose, target_job_id, bucket_id,
       object_prefix, expected_manifest, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       clock_timestamp() + interval '1 hour'
     )`,
    [
      sessionId,
      options.userId ?? apiCreateFixture.soloUser,
      options.companyId ?? apiCreateFixture.company,
      options.purpose ?? 'job.create_finished',
      options.targetJobId ?? null,
      options.bucketId ?? 'smart-job-company-files',
      upload.objectPrefix,
      JSON.stringify(upload.manifest),
    ],
  );
}

async function insertApiStorageObject(client, upload) {
  await client.query(
    `INSERT INTO storage.objects (
       id, bucket_id, name, owner_id, metadata, user_metadata
     ) VALUES ($1, 'smart-job-company-files', $2, $3, $4::jsonb, $5::jsonb)`,
    [
      randomUUID(),
      upload.objectPath,
      apiCreateFixture.soloUser,
      JSON.stringify({ size: 128, mimetype: 'image/jpeg' }),
      JSON.stringify({ sha256: upload.manifest[0].sha256 }),
    ],
  );
}

const uploadCleanupFixture = {
  user: randomUUID(),
  company: randomUUID(),
  membership: randomUUID(),
  job: randomUUID(),
};

function cleanupUploadManifest(sessionId, overrides = {}) {
  const attachmentId = randomUUID();
  const objectPrefix = [
    uploadCleanupFixture.company,
    uploadCleanupFixture.user,
    sessionId,
  ].join('/');
  const objectPath = `${objectPrefix}/${attachmentId}.jpg`;
  return {
    objectPrefix,
    objectPath,
    manifest: [{
      attachmentId,
      kind: 'photo',
      fileName: 'cleanup-fixture.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      sha256: createHash('sha256').update(sessionId).digest('hex'),
      objectPath,
      ...overrides,
    }],
  };
}

async function insertUploadCleanupFixture(client) {
  await client.query(
    `INSERT INTO public.app_users (id, email, display_name)
     VALUES ($1, $2, 'Upload cleanup manager')`,
    [
      uploadCleanupFixture.user,
      `upload-cleanup-${uploadCleanupFixture.user}@example.invalid`,
    ],
  );
  await client.query(
    `INSERT INTO public.companies (
       id, public_company_id, account_type, status, created_by_user_id
     ) VALUES ($1, $2, 'business', 'active', $3)`,
    [uploadCleanupFixture.company, publicCompanyBase + 200, uploadCleanupFixture.user],
  );
  await client.query(
    `INSERT INTO public.company_memberships (
       id, company_id, user_id, member_no, role, status, display_name
     ) VALUES ($1, $2, $3, 1, 'manager', 'active', 'Upload cleanup manager')`,
    [
      uploadCleanupFixture.membership,
      uploadCleanupFixture.company,
      uploadCleanupFixture.user,
    ],
  );
  await client.query(
    `INSERT INTO public.jobs (
       id, company_id, job_no, status, title, created_by_membership_id
     ) VALUES ($1, $2, 1, 'pending', 'Upload cleanup fixture', $3)`,
    [
      uploadCleanupFixture.job,
      uploadCleanupFixture.company,
      uploadCleanupFixture.membership,
    ],
  );
}

async function deleteUploadCleanupFixture(client) {
  await client.query(
    'DELETE FROM private.file_upload_sessions WHERE company_id = $1',
    [uploadCleanupFixture.company],
  ).catch(() => undefined);
  await client.query(
    'DELETE FROM public.companies WHERE id = $1',
    [uploadCleanupFixture.company],
  ).catch(() => undefined);
  await client.query(
    'DELETE FROM public.app_users WHERE id = $1',
    [uploadCleanupFixture.user],
  ).catch(() => undefined);
}

async function insertCleanupSession(client, {
  sessionId,
  upload,
  status = 'pending',
  cleanupAttempts = 0,
  consumed = false,
}) {
  await client.query(
    `INSERT INTO private.file_upload_sessions (
       id, user_id, company_id, purpose, bucket_id, object_prefix,
       expected_manifest, status, expires_at, consumed_at,
       consumed_by_job_id, cleanup_attempts, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'job.create_finished', 'smart-job-company-files', $4,
       $5::jsonb, $6, clock_timestamp() - interval '1 hour',
       CASE WHEN $7::boolean THEN clock_timestamp() - interval '1 hour' ELSE NULL END,
       CASE WHEN $7::boolean THEN $8::uuid ELSE NULL END,
       $9, clock_timestamp() - interval '2 hours',
       clock_timestamp() - interval '2 hours'
     )`,
    [
      sessionId,
      uploadCleanupFixture.user,
      uploadCleanupFixture.company,
      upload.objectPrefix,
      JSON.stringify(upload.manifest),
      consumed ? 'consumed' : status,
      consumed,
      uploadCleanupFixture.job,
      cleanupAttempts,
    ],
  );
}

if (!databaseUrl) {
  test('API security foundation integration tests', {
    skip: 'DATABASE_URL (or SMART_JOB_DATABASE_URL) is required for database integration tests',
  }, () => undefined);
} else {
  describe('API security foundation migration', { concurrency: false, timeout: 60_000 }, () => {
    before(async () => {
      assertLocalIntegrationDatabase();
      await withClient(async (client) => {
        const access = await client.query(
          `SELECT pg_has_role(current_user, 'smart_job_api', 'SET') AS can_set_runtime_role`,
        );
        assert.equal(
          access.rows[0]?.can_set_runtime_role,
          true,
          'DATABASE_URL must use the local migration/admin credential so tests can SET ROLE smart_job_api',
        );
        await deleteFixture(client);
        await insertFixture(client);
      });
    });

    after(async () => {
      await withClient(deleteFixture);
    });

    it('creates a constrained, least-privileged login role', async () => {
      await withClient(async (client) => {
        const roleResult = await client.query(
          `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                  rolinherit, rolreplication, rolbypassrls, rolconfig
           FROM pg_catalog.pg_roles
           WHERE rolname = 'smart_job_api'`,
        );
        assert.equal(roleResult.rowCount, 1);
        assert.deepEqual(
          roleResult.rows[0],
          {
            rolcanlogin: true,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: false,
            rolreplication: false,
            rolbypassrls: false,
            rolconfig: roleResult.rows[0].rolconfig,
          },
        );

        const roleConfig = roleResult.rows[0].rolconfig || [];
        assert.ok(roleConfig.some((value) => value.startsWith('statement_timeout=')));
        assert.ok(roleConfig.some((value) => value.startsWith('lock_timeout=')));
        assert.ok(roleConfig.some((value) => value.startsWith('idle_in_transaction_session_timeout=')));

        const privileges = await client.query(
          `SELECT
             has_schema_privilege('smart_job_api', 'public', 'USAGE') AS public_usage,
             has_schema_privilege('smart_job_api', 'private', 'USAGE') AS private_usage,
             has_table_privilege('smart_job_api', 'private.web_sessions', 'SELECT') AS sessions_read,
             has_table_privilege('smart_job_api', 'private.web_sessions', 'INSERT') AS sessions_write,
             has_table_privilege('smart_job_api', 'private.api_idempotency', 'SELECT') AS idempotency_read,
             has_table_privilege('smart_job_api', 'private.file_upload_sessions', 'INSERT') AS uploads_write,
             has_table_privilege('smart_job_api', 'public.jobs', 'SELECT') AS jobs_read,
             has_table_privilege('smart_job_api', 'public.jobs', 'UPDATE') AS jobs_direct_update,
             has_database_privilege(
               'smart_job_api', current_database(), 'TEMPORARY'
             ) AS api_temporary`,
        );
        assert.deepEqual(privileges.rows[0], {
          public_usage: true,
          private_usage: true,
          sessions_read: true,
          sessions_write: true,
          idempotency_read: true,
          uploads_write: false,
          jobs_read: true,
          jobs_direct_update: false,
          api_temporary: false,
        });
      });
    });

    it('exposes only the intended API RPCs to the runtime role', async () => {
      await withClient(async (client) => {
        const apiFunctions = await client.query(
          `SELECT
             p.oid::regprocedure::text AS signature,
             has_function_privilege('smart_job_api', p.oid, 'EXECUTE') AS api_execute,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
           FROM pg_catalog.pg_proc p
           INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'private'
             AND p.proname IN (
               'set_api_request_context',
               'complete_job_with_details',
               'prepare_api_file_upload_session',
               'record_api_file_upload_signing_failure'
             )
           ORDER BY p.proname`,
        );
        assert.equal(apiFunctions.rowCount, 4);
        for (const row of apiFunctions.rows) {
          assert.equal(row.api_execute, true, row.signature);
          assert.equal(row.anon_execute, false, row.signature);
          assert.equal(row.authenticated_execute, false, row.signature);
        }

        const legacyFunctions = await client.query(
          `SELECT
             n.nspname AS schema_name,
             p.proname,
             p.oid::regprocedure::text AS signature,
             has_function_privilege('smart_job_api', p.oid, 'EXECUTE') AS api_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
           FROM pg_catalog.pg_proc p
           INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('private', 'public')
             AND p.proname IN ('create_job_with_details', 'register_business_account')
           ORDER BY n.nspname, p.proname`,
        );
        assert.equal(legacyFunctions.rowCount, 4);
        for (const row of legacyFunctions.rows) {
          assert.equal(row.api_execute, false, row.signature);
          assert.equal(row.service_execute, true, row.signature);
        }
      });
    });

    it('hardens every SECURITY DEFINER helper reachable from job completion', async () => {
      await withClient(async (client) => {
        const helpers = await client.query(
          `SELECT
             p.oid::regprocedure::text AS signature,
             p.prosecdef,
             p.proconfig,
             has_function_privilege('smart_job_api', p.oid, 'EXECUTE') AS api_execute
           FROM pg_catalog.pg_proc p
           INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'private'
             AND p.proname IN (
               'apply_inventory_movement',
               'apply_job_inventory_consumption_batch',
               'bump_company_sync_version'
             )
           ORDER BY p.proname`,
        );
        assert.equal(helpers.rowCount, 3);
        for (const row of helpers.rows) {
          assert.equal(row.prosecdef, true, row.signature);
          assert.deepEqual(row.proconfig, ['search_path=""'], row.signature);
          assert.equal(row.api_execute, false, row.signature);
        }
      });
    });

    it('sets identity and timeouts only for the current transaction', async () => {
      await withClient(async (client) => {
        await client.query('BEGIN');
        try {
          await setRuntimeContext(client, fixture.userA);
          const context = await client.query(
            `SELECT
               current_setting('request.jwt.claim.sub', true) AS request_uid,
               private.app_auth_uid() AS helper_uid,
               EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000 AS statement_ms,
               EXTRACT(EPOCH FROM current_setting('lock_timeout')::interval) * 1000 AS lock_ms,
               EXTRACT(EPOCH FROM current_setting('idle_in_transaction_session_timeout')::interval) * 1000 AS idle_ms`,
          );
          assert.equal(context.rows[0].request_uid, fixture.userA);
          assert.equal(context.rows[0].helper_uid, fixture.userA);
          assert.equal(Number(context.rows[0].statement_ms), 12_000);
          assert.equal(Number(context.rows[0].lock_ms), 3_000);
          assert.equal(Number(context.rows[0].idle_ms), 15_000);
        } finally {
          await client.query('ROLLBACK');
        }

        const restored = await client.query(
          `SELECT current_setting('request.jwt.claim.sub', true) AS request_uid,
                  current_user AS current_user`,
        );
        assert.ok(!restored.rows[0].request_uid);
        assert.notEqual(restored.rows[0].current_user, 'smart_job_api');
      });
    });

    it('stores only encrypted web credentials and enforces the absolute lifetime', async () => {
      const columns = await withClient((client) => client.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'private' AND table_name = 'web_sessions'`,
      ));
      const byName = new Map(columns.rows.map((row) => [row.column_name, row.data_type]));
      for (const name of [
        'session_token_hash',
        'csrf_token_hash',
        'credentials_ciphertext',
        'credentials_iv',
        'credentials_auth_tag',
      ]) {
        assert.equal(byName.get(name), 'bytea', name);
      }
      for (const forbidden of [
        'session_token',
        'csrf_token',
        'access_token',
        'refresh_token',
        'credentials',
      ]) {
        assert.equal(byName.has(forbidden), false, forbidden);
      }

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        const valid = await client.query(
          `INSERT INTO private.web_sessions (
             session_token_hash, csrf_token_hash, user_id, supabase_session_id,
             credentials_ciphertext, credentials_iv, credentials_auth_tag,
             encryption_key_version, access_token_expires_at, absolute_expires_at,
             last_company_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'test-key-v1',
                     clock_timestamp() + interval '1 hour',
                     clock_timestamp() + interval '11 hours', $8)
           RETURNING id`,
          [
            sha256('session-valid'),
            sha256('csrf-valid'),
            fixture.userA,
            randomUUID(),
            Buffer.from('encrypted-credentials'),
            Buffer.alloc(12, 1),
            Buffer.alloc(16, 2),
            fixture.companyA,
          ],
        );
        assert.equal(valid.rowCount, 1);
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.web_sessions (
               session_token_hash, csrf_token_hash, user_id, supabase_session_id,
               credentials_ciphertext, credentials_iv, credentials_auth_tag,
               encryption_key_version, access_token_expires_at, absolute_expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'test-key-v1',
                       clock_timestamp() + interval '1 hour',
                       clock_timestamp() + interval '13 hours')`,
            [
              sha256('session-too-long'),
              sha256('csrf-too-long'),
              fixture.userA,
              randomUUID(),
              Buffer.from('encrypted-credentials'),
              Buffer.alloc(12, 1),
              Buffer.alloc(16, 2),
            ],
          ),
          '23514',
          /web_sessions_absolute_lifetime_check/,
        );
      });
    });

    it('isolates idempotency rows with RLS and scopes uniqueness by tenant', async () => {
      const keyHash = sha256('same-key');
      const requestHash = sha256('same-request');

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO private.api_idempotency (
             user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
           ) VALUES
             ($1, $2, 'job.complete', $5, $6, clock_timestamp() + interval '1 hour'),
             ($3, $4, 'job.complete', $5, $6, clock_timestamp() + interval '1 hour')`,
          [fixture.userA, fixture.companyA, fixture.userB, fixture.companyB, keyHash, requestHash],
        );
        await setRuntimeContext(client, fixture.userA);
        const visible = await client.query(
          `SELECT user_id, company_id
           FROM private.api_idempotency
           ORDER BY user_id`,
        );
        assert.deepEqual(visible.rows, [{ user_id: fixture.userA, company_id: fixture.companyA }]);
      });

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO private.api_idempotency (
             user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
           ) VALUES
             ($1, NULL, 'job.complete', $4, $5, clock_timestamp() + interval '1 hour'),
             ($1, $2, 'job.complete', $4, $5, clock_timestamp() + interval '1 hour'),
             ($1, $3, 'job.complete', $4, $5, clock_timestamp() + interval '1 hour')`,
          [fixture.userA, fixture.companyA, fixture.companyB, keyHash, requestHash],
        );
        const count = await client.query(
          `SELECT count(*)::integer AS count
           FROM private.api_idempotency
           WHERE user_id = $1 AND operation = 'job.complete'
             AND idempotency_key_hash = $2`,
          [fixture.userA, keyHash],
        );
        assert.equal(count.rows[0].count, 3);
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        await client.query(
          `INSERT INTO private.api_idempotency (
             user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
           ) VALUES ($1, NULL, 'job.complete', $2, $3, clock_timestamp() + interval '1 hour')`,
          [fixture.userA, keyHash, requestHash],
        );
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.api_idempotency (
               user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
             ) VALUES ($1, NULL, 'job.complete', $2, $3, clock_timestamp() + interval '1 hour')`,
            [fixture.userA, keyHash, requestHash],
          ),
          '23505',
          /api_idempotency_global_key_unique/,
        );
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.api_idempotency (
               user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
             ) VALUES ($1, $2, 'job.complete', $3, $4, clock_timestamp() + interval '1 hour')`,
            [fixture.userA, fixture.companyB, sha256('cross-tenant'), requestHash],
          ),
          '42501',
          /row-level security policy/,
        );
      });
    });

    it('enforces upload ownership, purpose, target, and manifest constraints', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO private.file_upload_sessions (
             id, user_id, company_id, purpose, bucket_id, object_prefix,
             expected_manifest, expires_at
           ) VALUES
             ($1, $2, $3, 'job.create_finished', 'company-files', $4, $5,
              clock_timestamp() + interval '1 hour'),
             ($6, $7, $8, 'job.create_finished', 'company-files', $9, $10,
              clock_timestamp() + interval '1 hour')`,
          [
            sessionA,
            fixture.userA,
            fixture.companyA,
            `${fixture.userA}/${sessionA}`,
            JSON.stringify(uploadManifest(fixture.userA, sessionA)),
            sessionB,
            fixture.userB,
            fixture.companyB,
            `${fixture.userB}/${sessionB}`,
            JSON.stringify(uploadManifest(fixture.userB, sessionB)),
          ],
        );
        await setRuntimeContext(client, fixture.userA);
        const visible = await client.query(
          'SELECT id FROM private.file_upload_sessions ORDER BY id',
        );
        assert.deepEqual(visible.rows, [{ id: sessionA }]);
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        const sessionId = randomUUID();
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.file_upload_sessions (
               id, user_id, company_id, purpose, bucket_id, object_prefix,
               expected_manifest, expires_at
             ) VALUES ($1, $2, $3, 'job.complete_assigned', 'company-files', $4,
                       $5, clock_timestamp() + interval '1 hour')`,
            [
              sessionId,
              fixture.userA,
              fixture.companyA,
              `${fixture.userA}/${sessionId}`,
              JSON.stringify(uploadManifest(fixture.userA, sessionId)),
            ],
          ),
          '42501',
          /permission denied for table file_upload_sessions/,
        );
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        const sessionId = randomUUID();
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.file_upload_sessions (
               id, user_id, company_id, purpose, bucket_id, object_prefix,
               expected_manifest, expires_at
            ) VALUES ($1, $2, $3, 'job.create_finished', 'company-files', $4,
                       $5, clock_timestamp() + interval '1 hour')`,
            [sessionId, fixture.userA, fixture.companyA, `${fixture.userA}/${sessionId}`, '[]'],
          ),
          '42501',
          /permission denied for table file_upload_sessions/,
        );
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        const sessionId = randomUUID();
        await expectDatabaseError(
          client.query(
            `INSERT INTO private.file_upload_sessions (
               id, user_id, company_id, purpose, bucket_id, object_prefix,
               expected_manifest, expires_at
             ) VALUES ($1, $2, $3, 'job.create_finished', 'company-files', $4,
                       $5, clock_timestamp() + interval '1 hour')`,
            [
              sessionId,
              fixture.userA,
              fixture.companyB,
              `${fixture.userA}/${sessionId}`,
              JSON.stringify(uploadManifest(fixture.userA, sessionId)),
            ],
          ),
          '42501',
          /permission denied for table file_upload_sessions/,
        );
      });
    });

    it('prepares one deterministic upload session and does not charge its retry twice', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        await setRuntimeContext(client, fixture.userA);
        await insertUploadIdempotencyClaim(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
        );

        const first = await prepareApiUploadSession(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
        );
        const replay = await prepareApiUploadSession(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
          first.upload,
        );
        assert.equal(first.result.rows[0].outcome, 'created');
        assert.equal(replay.result.rows[0].outcome, 'reused');
        assert.equal(first.result.rows[0].session_id, sessionId);
        assert.equal(replay.result.rows[0].session_id, sessionId);
        assert.equal(
          replay.result.rows[0].session_expires_at.getTime(),
          first.result.rows[0].session_expires_at.getTime(),
        );

        await client.query('RESET ROLE');
        const limiter = await client.query(
          `SELECT hit_count
           FROM public.rate_limit_buckets
           WHERE hashed_key = pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to($1, 'UTF8'),
               'sha256'
             ),
             'hex'
           )`,
          [`api-upload-session:${fixture.userA}`],
        );
        assert.deepEqual(limiter.rows, [{ hit_count: 1 }]);
      });
    });

    it('moves an unsigned session to bounded cleanup after three signing failures', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        await setRuntimeContext(client, fixture.userA);
        await insertUploadIdempotencyClaim(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
        );
        const prepared = await prepareApiUploadSession(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
        );
        assert.equal(prepared.result.rows[0].outcome, 'created');

        const outcomes = [];
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const failure = await client.query(
            `SELECT *
             FROM private.record_api_file_upload_signing_failure($1, $2)`,
            [sessionId, `storage_unavailable_${attempt}`],
          );
          outcomes.push(failure.rows[0]);
        }
        assert.deepEqual(outcomes, [
          { session_status: 'pending', failure_count: 1 },
          { session_status: 'pending', failure_count: 2 },
          { session_status: 'cleanup_pending', failure_count: 3 },
        ]);

        const unavailable = await prepareApiUploadSession(
          client,
          fixture.userA,
          fixture.companyA,
          sessionId,
          prepared.upload,
        );
        assert.equal(unavailable.result.rows[0].outcome, 'unavailable');
      });
    });

    it('commits at most four concurrent pending sessions per user and workspace', async () => {
      const existingSessions = [randomUUID(), randomUUID(), randomUUID()];
      const firstSession = randomUUID();
      const secondSession = randomUUID();
      try {
        await withClient(async (client) => {
          await client.query('BEGIN');
          try {
            for (const sessionId of existingSessions) {
              const upload = canonicalApiUpload(
                fixture.companyA,
                fixture.userA,
                sessionId,
              );
              await client.query(
                `INSERT INTO private.file_upload_sessions (
                   id, user_id, company_id, purpose, bucket_id,
                   object_prefix, expected_manifest, expires_at
                 ) VALUES (
                   $1, $2, $3, 'job.create_finished',
                   'smart-job-company-files', $4, $5,
                   clock_timestamp() + interval '1 hour'
                 )`,
                [
                  sessionId,
                  fixture.userA,
                  fixture.companyA,
                  upload.objectPrefix,
                  JSON.stringify(upload.manifest),
                ],
              );
            }
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        });

        const first = databaseClient();
        const second = databaseClient();
        await Promise.all([first.connect(), second.connect()]);
        try {
          await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
          await Promise.all([
            setRuntimeContext(first, fixture.userA),
            setRuntimeContext(second, fixture.userA),
          ]);
          await insertUploadIdempotencyClaim(
            first,
            fixture.userA,
            fixture.companyA,
            firstSession,
          );
          await insertUploadIdempotencyClaim(
            second,
            fixture.userA,
            fixture.companyA,
            secondSession,
          );

          const firstPrepared = await prepareApiUploadSession(
            first,
            fixture.userA,
            fixture.companyA,
            firstSession,
          );
          const secondPreparation = prepareApiUploadSession(
            second,
            fixture.userA,
            fixture.companyA,
            secondSession,
          );
          await first.query('COMMIT');
          const secondPrepared = await secondPreparation;
          await second.query('COMMIT');

          assert.equal(firstPrepared.result.rows[0].outcome, 'created');
          assert.equal(secondPrepared.result.rows[0].outcome, 'quota_exceeded');
        } finally {
          await Promise.all([
            first.query('ROLLBACK').catch(() => undefined),
            second.query('ROLLBACK').catch(() => undefined),
          ]);
          await Promise.all([first.end(), second.end()]);
        }

        await withClient(async (client) => {
          const pending = await client.query(
            `SELECT count(*)::integer AS count
             FROM private.file_upload_sessions
             WHERE user_id = $1 AND company_id = $2
               AND status = 'pending' AND expires_at > clock_timestamp()`,
            [fixture.userA, fixture.companyA],
          );
          assert.equal(pending.rows[0].count, 4);
        });
      } finally {
        await withClient(async (client) => {
          await client.query(
            `DELETE FROM private.file_upload_sessions
             WHERE id = ANY($1::uuid[])`,
            [[...existingSessions, firstSession, secondSession]],
          ).catch(() => undefined);
          await client.query(
            `DELETE FROM private.api_idempotency
             WHERE id = ANY($1::uuid[])`,
            [[firstSession, secondSession]],
          ).catch(() => undefined);
          await client.query(
            `DELETE FROM public.rate_limit_buckets
             WHERE hashed_key = pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to($1, 'UTF8'),
                 'sha256'
               ),
               'hex'
             )`,
            [`api-upload-session:${fixture.userA}`],
          ).catch(() => undefined);
        });
      }
    });

    it('persists the per-user upload limiter and denies the thirteenth new session', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        for (let index = 1; index <= 13; index += 1) {
          const sessionId = randomUUID();
          await insertUploadIdempotencyClaim(
            client,
            fixture.userA,
            fixture.companyA,
            sessionId,
          );
          const preparation = await prepareApiUploadSession(
            client,
            fixture.userA,
            fixture.companyA,
            sessionId,
          );
          if (index <= 12) {
            assert.equal(preparation.result.rows[0].outcome, 'created');
            for (let failure = 0; failure < 3; failure += 1) {
              await client.query(
                `SELECT *
                 FROM private.record_api_file_upload_signing_failure($1, 'fixture')`,
                [sessionId],
              );
            }
          } else {
            assert.equal(preparation.result.rows[0].outcome, 'rate_limited');
            assert.ok(preparation.result.rows[0].rate_limit_reset_at instanceof Date);
          }
        }

        await client.query('RESET ROLE');
        const limiter = await client.query(
          `SELECT hit_count
           FROM public.rate_limit_buckets
           WHERE hashed_key = pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to($1, 'UTF8'),
               'sha256'
             ),
             'hex'
           )`,
          [`api-upload-session:${fixture.userA}`],
        );
        assert.deepEqual(limiter.rows, [{ hit_count: 13 }]);
      });
    });

    it('completes a job atomically and rejects stale entity versions', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        const beforeSync = await client.query(
          'SELECT jobs_version FROM public.company_sync_state WHERE company_id = $1',
          [fixture.companyA],
        );
        const result = await completeJob(client, fixture.jobA);
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0].job_id, fixture.jobA);
        assert.equal(result.rows[0].status, 'finished');
        assert.equal(String(result.rows[0].entity_version), '2');

        const stored = await client.query(
          `SELECT status, entity_version, accepted_by_user_id, accepted_at, finished_at
           FROM public.jobs WHERE id = $1`,
          [fixture.jobA],
        );
        assert.equal(stored.rows[0].status, 'finished');
        assert.equal(String(stored.rows[0].entity_version), '2');
        assert.equal(stored.rows[0].accepted_by_user_id, fixture.userA);
        assert.deepEqual(stored.rows[0].accepted_at, stored.rows[0].finished_at);
        assert.ok(stored.rows[0].finished_at instanceof Date);

        const afterSync = await client.query(
          'SELECT jobs_version FROM public.company_sync_state WHERE company_id = $1',
          [fixture.companyA],
        );
        assert.equal(afterSync.rows[0].jobs_version, beforeSync.rows[0].jobs_version + 1);
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        await expectDatabaseError(
          completeJob(client, fixture.jobA, 99),
          '40001',
          /ENTITY_VERSION_CONFLICT/,
        );
      });
    });

    it('rejects completion when the jobs tier or canonical override disables it', async () => {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE public.company_subscriptions
           SET tier = 'Basic', enabled_modules = '{}'::jsonb
           WHERE company_id = $1`,
          [fixture.companyA],
        );
        await setRuntimeContext(client, fixture.userA);
        await expectDatabaseError(
          completeJob(client, fixture.jobA),
          '42501',
          /JOBS_MODULE_DISABLED/,
        );
      });

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE public.company_subscriptions
           SET tier = 'Team',
               enabled_modules = '{"solojob":false,"jobs":true}'::jsonb
           WHERE company_id = $1`,
          [fixture.companyA],
        );
        await setRuntimeContext(client, fixture.userA);
        await expectDatabaseError(
          completeJob(client, fixture.jobA),
          '42501',
          /JOBS_MODULE_DISABLED/,
        );
      });

      const unchanged = await withClient((client) => client.query(
        `SELECT status, entity_version, accepted_by_user_id, accepted_at, finished_at
         FROM public.jobs
         WHERE id = $1`,
        [fixture.jobA],
      ));
      assert.deepEqual(unchanged.rows[0], {
        status: 'pending',
        entity_version: '1',
        accepted_by_user_id: null,
        accepted_at: null,
        finished_at: null,
      });
    });

    it('rolls back all job changes when part validation fails', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, fixture.userA);
        await client.query('SAVEPOINT before_invalid_completion');
        await expectDatabaseError(
          completeJob(client, fixture.jobA, 1, [{ partId: 2_147_483_647, quantity: 1 }]),
          '22023',
          /INVENTORY_PART_NOT_FOUND/,
        );
        await client.query('ROLLBACK TO SAVEPOINT before_invalid_completion');
        const stored = await client.query(
          `SELECT status, entity_version, finished_at
           FROM public.jobs WHERE id = $1`,
          [fixture.jobA],
        );
        assert.deepEqual(stored.rows[0], {
          status: 'pending',
          entity_version: '1',
          finished_at: null,
        });
      });
    });

    it('allows exactly one concurrent completion for an entity version', async () => {
      const first = databaseClient();
      const second = databaseClient();
      await Promise.all([first.connect(), second.connect()]);
      try {
        await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
        await Promise.all([
          setRuntimeContext(first, fixture.userA),
          setRuntimeContext(second, fixture.userA),
        ]);

        const winner = await completeJob(first, fixture.concurrentJob, 1);
        assert.equal(winner.rows[0].status, 'finished');

        const contender = completeJob(second, fixture.concurrentJob, 1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await first.query('COMMIT');
        await expectDatabaseError(contender, '40001', /ENTITY_VERSION_CONFLICT/);
        await second.query('ROLLBACK');

        const stored = await withClient((client) => client.query(
          `SELECT status, entity_version
           FROM public.jobs WHERE id = $1`,
          [fixture.concurrentJob],
        ));
        assert.deepEqual(stored.rows[0], { status: 'finished', entity_version: '2' });
      } finally {
        await first.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
        await Promise.all([first.end(), second.end()]);
      }
    });
  });

  describe('API job creation and private Storage migration', {
    concurrency: false,
    timeout: 60_000,
  }, () => {
    before(async () => {
      assertLocalIntegrationDatabase();
      await withClient(async (client) => {
        await deleteApiCreateFixture(client);
        await insertApiCreateFixture(client);
      });
    });

    after(async () => {
      await withClient(deleteApiCreateFixture);
    });

    it('creates the canonical private company-file bucket and exposes only the API RPC', async () => {
      await withClient(async (client) => {
        const bucket = await client.query(
          `SELECT id, name, public, file_size_limit, allowed_mime_types
           FROM storage.buckets
           WHERE id = 'smart-job-company-files'`,
        );
        assert.deepEqual(bucket.rows, [{
          id: 'smart-job-company-files',
          name: 'smart-job-company-files',
          public: false,
          file_size_limit: '10485760',
          allowed_mime_types: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif',
            'application/pdf',
          ],
        }]);

        const signature = [
          'private.create_api_job_with_details(',
          'uuid,public.job_status,text,text,text,text,integer,jsonb,jsonb,uuid,',
          'timestamp with time zone)',
        ].join('');
        const privileges = await client.query(
          `SELECT
             has_function_privilege('smart_job_api', $1, 'EXECUTE') AS api_execute,
             has_function_privilege('service_role', $1, 'EXECUTE') AS service_execute,
             has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute,
             has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute`,
          [signature],
        );
        assert.deepEqual(privileges.rows[0], {
          api_execute: true,
          service_execute: true,
          authenticated_execute: false,
          anon_execute: false,
        });

        const functionSecurity = await client.query(
          `SELECT procedure.prosecdef, procedure.proconfig
           FROM pg_catalog.pg_proc AS procedure
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'private'
             AND procedure.proname = 'create_api_job_with_details'`,
        );
        assert.equal(functionSecurity.rows[0]?.prosecdef, true);
        assert.deepEqual(functionSecurity.rows[0]?.proconfig, ['search_path=""']);
      });
    });

    it('derives creator context and resolves tenant UUID/public references in SQL', async () => {
      await withTransaction(async (client) => {
        const beforeSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );
        await setRuntimeContext(client, apiCreateFixture.managerUser);

        const first = await createApiJob(client, {
          title: '  Tenant resolved job  ',
          clientId: apiCreateFixture.client,
          assigneeMemberNo: 3,
          location: 'Jerusalem',
          details: { timeFrom: '08:30', timeTo: '09:45' },
          parts: [{ partId: 501, quantity: 1.25 }],
        });
        assert.equal(first.rowCount, 1);
        assert.equal(first.rows[0].job_no, 1);
        assert.equal(first.rows[0].status, 'pending');
        assert.equal(first.rows[0].entity_version, '1');
        assert.equal(first.rows[0].finished_at, null);

        const second = await createApiJob(client, {
          title: 'Public client number job',
          clientId: '71',
        });
        assert.equal(second.rows[0].job_no, 2);

        await client.query('RESET ROLE');
        const jobs = await client.query(
          `SELECT
             id, job_no, title, client_id, assigned_membership_id,
             created_by_membership_id, client_name_snapshot,
             assigned_member_name_snapshot, created_by_name_snapshot, meta
           FROM public.jobs
           WHERE id IN ($1::uuid, $2::uuid)
           ORDER BY job_no`,
          [first.rows[0].job_id, second.rows[0].job_id],
        );
        assert.equal(jobs.rows[0].title, 'Tenant resolved job');
        assert.equal(jobs.rows[0].client_id, apiCreateFixture.client);
        assert.equal(jobs.rows[0].assigned_membership_id, apiCreateFixture.workerMembership);
        assert.equal(jobs.rows[0].created_by_membership_id, apiCreateFixture.managerMembership);
        assert.equal(jobs.rows[0].client_name_snapshot, 'API create client');
        assert.equal(jobs.rows[0].assigned_member_name_snapshot, 'API create worker');
        assert.equal(jobs.rows[0].created_by_name_snapshot, 'API create manager');
        assert.deepEqual(jobs.rows[0].meta, { timeFrom: '08:30', timeTo: '09:45' });
        assert.equal(jobs.rows[1].client_id, apiCreateFixture.client);

        const usage = await client.query(
          `SELECT inventory_part_id, part_name_snapshot, quantity
           FROM public.job_part_usages WHERE job_id = $1`,
          [first.rows[0].job_id],
        );
        assert.equal(usage.rows[0].inventory_part_id, apiCreateFixture.part);
        assert.equal(usage.rows[0].part_name_snapshot, 'API fixture part');
        assert.equal(Number(usage.rows[0].quantity), 1.25);

        const afterSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );
        assert.equal(
          afterSync.rows[0].jobs_version,
          beforeSync.rows[0].jobs_version + 2,
        );
        assert.equal(
          afterSync.rows[0].company_inventory_version,
          beforeSync.rows[0].company_inventory_version,
        );
      });
    });

    it('rejects cross-tenant references before allocating a job number', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, apiCreateFixture.managerUser);

        await client.query('SAVEPOINT cross_tenant_client');
        await expectDatabaseError(
          createApiJob(client, { clientId: apiCreateFixture.otherClient }),
          'P0002',
          /CLIENT_NOT_FOUND/,
        );
        await client.query('ROLLBACK TO SAVEPOINT cross_tenant_client');

        await client.query('SAVEPOINT cross_tenant_assignee');
        await expectDatabaseError(
          createApiJob(client, { assigneeMemberNo: 99 }),
          'P0002',
          /ASSIGNEE_NOT_FOUND/,
        );
        await client.query('ROLLBACK TO SAVEPOINT cross_tenant_assignee');

        await client.query('SAVEPOINT cross_tenant_part');
        await expectDatabaseError(
          createApiJob(client, { parts: [{ partId: 777, quantity: 1 }] }),
          'P0002',
          /INVENTORY_PART_NOT_FOUND/,
        );
        await client.query('ROLLBACK TO SAVEPOINT cross_tenant_part');

        await client.query('RESET ROLE');
        const counter = await client.query(
          `SELECT next_value FROM public.company_counters
           WHERE company_id = $1 AND counter_key = 'job_no'`,
          [apiCreateFixture.company],
        );
        assert.equal(counter.rowCount, 0);
      });
    });

    it('enforces membership roles, solo status, and jobs entitlement', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, apiCreateFixture.workerUser);
        await expectDatabaseError(
          createApiJob(client),
          '42501',
          /JOB_CREATION_FORBIDDEN/,
        );
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, apiCreateFixture.soloUser);
        await expectDatabaseError(
          createApiJob(client, { status: 'pending' }),
          '42501',
          /SOLO_PENDING_JOB_FORBIDDEN/,
        );
      });

      await withTransaction(async (client) => {
        await setRuntimeContext(client, apiCreateFixture.otherUser);
        await expectDatabaseError(
          createApiJob(client),
          '42501',
          /COMPANY_MEMBERSHIP_REQUIRED/,
        );
      });

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE public.company_subscriptions
           SET tier = 'Basic', enabled_modules = '{}'::jsonb
           WHERE company_id = $1`,
          [apiCreateFixture.company],
        );
        await setRuntimeContext(client, apiCreateFixture.managerUser);
        await expectDatabaseError(
          createApiJob(client),
          '42501',
          /JOBS_MODULE_DISABLED/,
        );
      });
    });

    it('atomically creates a finished solo job, consumes stock and finalizes uploads', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        const upload = createApiUploadManifest(sessionId);
        await insertApiUploadSession(client, sessionId, upload);
        await insertApiStorageObject(client, upload);
        const beforeSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );

        await setRuntimeContext(client, apiCreateFixture.soloUser);
        const result = await createApiJob(client, {
          status: 'finished',
          title: 'Finished solo fixture',
          clientId: '71',
          details: {
            timeFrom: '10:00',
            timeTo: '11:00',
            signingPerson: 'Fixture customer',
            travelDistance: 12.5,
          },
          parts: [{ partId: 501, quantity: 2 }],
          uploadSessionId: sessionId,
        });
        assert.equal(result.rows[0].status, 'finished');
        assert.equal(result.rows[0].entity_version, '1');
        assert.ok(result.rows[0].finished_at instanceof Date);

        await client.query('RESET ROLE');
        const stored = await client.query(
          `SELECT assigned_membership_id, created_by_membership_id,
                  accepted_by_user_id, finished_at
           FROM public.jobs WHERE id = $1`,
          [result.rows[0].job_id],
        );
        assert.equal(stored.rows[0].assigned_membership_id, apiCreateFixture.soloMembership);
        assert.equal(stored.rows[0].created_by_membership_id, apiCreateFixture.soloMembership);
        assert.equal(stored.rows[0].accepted_by_user_id, apiCreateFixture.soloUser);
        assert.ok(stored.rows[0].finished_at instanceof Date);

        const attachment = await client.query(
          `SELECT id, storage_path, kind, uploaded_by_user_id
           FROM public.job_attachments WHERE job_id = $1`,
          [result.rows[0].job_id],
        );
        assert.deepEqual(attachment.rows[0], {
          id: upload.manifest[0].attachmentId,
          storage_path: upload.objectPath,
          kind: 'photo',
          uploaded_by_user_id: apiCreateFixture.soloUser,
        });

        const uploadSession = await client.query(
          `SELECT status, consumed_by_job_id, consumed_at
           FROM private.file_upload_sessions WHERE id = $1`,
          [sessionId],
        );
        assert.equal(uploadSession.rows[0].status, 'consumed');
        assert.equal(uploadSession.rows[0].consumed_by_job_id, result.rows[0].job_id);
        assert.ok(uploadSession.rows[0].consumed_at instanceof Date);

        const balances = await client.query(
          `SELECT location.location_type, balance.quantity_on_hand
           FROM public.inventory_balances AS balance
           INNER JOIN public.inventory_locations AS location
             ON location.id = balance.location_id
           WHERE location.company_id = $1 AND balance.part_id = $2
           ORDER BY location.location_type`,
          [apiCreateFixture.company, apiCreateFixture.part],
        );
        assert.deepEqual(
          balances.rows.map((row) => [row.location_type, Number(row.quantity_on_hand)]),
          [['member', 8], ['consumed', 2]],
        );

        const movement = await client.query(
          `SELECT quantity, movement_type, job_id
           FROM public.inventory_movements WHERE job_id = $1`,
          [result.rows[0].job_id],
        );
        assert.equal(Number(movement.rows[0].quantity), 2);
        assert.equal(movement.rows[0].movement_type, 'job_consumption');

        const afterSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );
        assert.equal(afterSync.rows[0].jobs_version, beforeSync.rows[0].jobs_version + 1);
        assert.equal(
          afterSync.rows[0].company_inventory_version,
          beforeSync.rows[0].company_inventory_version + 1,
        );
      });
    });

    it('rolls back the job, counter, upload and inventory when consumption fails', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        const upload = createApiUploadManifest(sessionId);
        await insertApiUploadSession(client, sessionId, upload);
        await insertApiStorageObject(client, upload);
        const beforeSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );

        await setRuntimeContext(client, apiCreateFixture.soloUser);
        await client.query('SAVEPOINT before_failed_api_create');
        await expectDatabaseError(
          createApiJob(client, {
            status: 'finished',
            title: 'Must roll back completely',
            parts: [{ partId: 501, quantity: 999 }],
            uploadSessionId: sessionId,
          }),
          'P0001',
          /inventory_insufficient_stock/,
        );
        await client.query('ROLLBACK TO SAVEPOINT before_failed_api_create');
        await client.query('RESET ROLE');

        const job = await client.query(
          `SELECT id FROM public.jobs
           WHERE company_id = $1 AND title = 'Must roll back completely'`,
          [apiCreateFixture.company],
        );
        assert.equal(job.rowCount, 0);
        const counter = await client.query(
          `SELECT next_value FROM public.company_counters
           WHERE company_id = $1 AND counter_key = 'job_no'`,
          [apiCreateFixture.company],
        );
        assert.equal(counter.rowCount, 0);
        const session = await client.query(
          `SELECT status, consumed_at, consumed_by_job_id
           FROM private.file_upload_sessions WHERE id = $1`,
          [sessionId],
        );
        assert.deepEqual(session.rows[0], {
          status: 'pending',
          consumed_at: null,
          consumed_by_job_id: null,
        });
        const attachment = await client.query(
          `SELECT id FROM public.job_attachments WHERE id = $1`,
          [upload.manifest[0].attachmentId],
        );
        assert.equal(attachment.rowCount, 0);
        const stock = await client.query(
          `SELECT quantity_on_hand FROM public.inventory_balances
           WHERE location_id = $1 AND part_id = $2`,
          [apiCreateFixture.soloLocation, apiCreateFixture.part],
        );
        assert.equal(Number(stock.rows[0].quantity_on_hand), 10);
        const afterSync = await client.query(
          `SELECT jobs_version, company_inventory_version
           FROM public.company_sync_state WHERE company_id = $1`,
          [apiCreateFixture.company],
        );
        assert.deepEqual(afterSync.rows[0], beforeSync.rows[0]);
      });
    });

    it('rejects a manifest whose object is not present in the private bucket', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        const upload = createApiUploadManifest(sessionId);
        await insertApiUploadSession(client, sessionId, upload);
        await setRuntimeContext(client, apiCreateFixture.soloUser);
        await expectDatabaseError(
          createApiJob(client, {
            status: 'finished',
            uploadSessionId: sessionId,
          }),
          '22023',
          /UPLOAD_OBJECT_MISMATCH/,
        );
      });
    });

    it('allocates unique sequential job numbers under concurrent creation', async () => {
      const first = databaseClient();
      const second = databaseClient();
      await Promise.all([first.connect(), second.connect()]);
      try {
        await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
        await Promise.all([
          setRuntimeContext(first, apiCreateFixture.managerUser),
          setRuntimeContext(second, apiCreateFixture.managerUser),
        ]);

        const firstResult = await createApiJob(first, { title: 'Concurrent API job one' });
        const secondRequest = createApiJob(second, { title: 'Concurrent API job two' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await first.query('COMMIT');
        const secondResult = await secondRequest;
        await second.query('COMMIT');

        assert.deepEqual(
          [firstResult.rows[0].job_no, secondResult.rows[0].job_no],
          [1, 2],
        );
        const stored = await withClient((client) => client.query(
          `SELECT job_no FROM public.jobs
           WHERE company_id = $1 AND title LIKE 'Concurrent API job %'
           ORDER BY job_no`,
          [apiCreateFixture.company],
        ));
        assert.deepEqual(stored.rows, [{ job_no: 1 }, { job_no: 2 }]);
      } finally {
        await first.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
        await Promise.all([first.end(), second.end()]);
      }
    });
  });

  describe('bounded abandoned upload-session cleanup', {
    concurrency: false,
    timeout: 60_000,
  }, () => {
    before(async () => {
      assertLocalIntegrationDatabase();
      await withClient(async (client) => {
        await deleteUploadCleanupFixture(client);
        await insertUploadCleanupFixture(client);
      });
    });

    after(async () => {
      await withClient(deleteUploadCleanupFixture);
    });

    it('exposes maintenance RPCs only to service_role', async () => {
      await withClient(async (client) => {
        const privileges = await client.query(
          `SELECT
             has_function_privilege(
               'service_role',
               'public.queue_expired_file_upload_cleanup(timestamptz)',
               'EXECUTE'
             ) AS service_can_queue,
             has_function_privilege(
               'service_role',
               'public.claim_file_upload_cleanup_batch(integer,integer,timestamptz)',
               'EXECUTE'
             ) AS service_can_claim,
             has_function_privilege(
               'service_role',
               'public.finish_file_upload_cleanup(uuid,integer,boolean,text,timestamptz)',
               'EXECUTE'
             ) AS service_can_finish,
             has_function_privilege(
               'anon',
               'public.claim_file_upload_cleanup_batch(integer,integer,timestamptz)',
               'EXECUTE'
             ) AS anon_can_claim,
             has_function_privilege(
               'authenticated',
               'public.claim_file_upload_cleanup_batch(integer,integer,timestamptz)',
               'EXECUTE'
             ) AS authenticated_can_claim,
             has_function_privilege(
               'smart_job_api',
               'public.claim_file_upload_cleanup_batch(integer,integer,timestamptz)',
               'EXECUTE'
             ) AS api_can_claim`,
        );
        assert.deepEqual(privileges.rows[0], {
          service_can_queue: true,
          service_can_claim: true,
          service_can_finish: true,
          anon_can_claim: false,
          authenticated_can_claim: false,
          api_can_claim: false,
        });
      });
    });

    it('queues only expired pending work and never exposes consumed or cross-prefix paths', async () => {
      await withTransaction(async (client) => {
        const expiredSessionId = randomUUID();
        const consumedSessionId = randomUUID();
        const crossPrefixSessionId = randomUUID();
        const expiredUpload = cleanupUploadManifest(expiredSessionId);
        const consumedUpload = cleanupUploadManifest(consumedSessionId);
        const crossPrefixUpload = cleanupUploadManifest(crossPrefixSessionId, {
          objectPath: `${uploadCleanupFixture.company}/${uploadCleanupFixture.user}/${expiredSessionId}/${randomUUID()}.jpg`,
        });

        await insertCleanupSession(client, {
          sessionId: expiredSessionId,
          upload: expiredUpload,
        });
        await insertCleanupSession(client, {
          sessionId: consumedSessionId,
          upload: consumedUpload,
          consumed: true,
        });
        await insertCleanupSession(client, {
          sessionId: crossPrefixSessionId,
          upload: crossPrefixUpload,
        });

        await client.query('SET LOCAL ROLE service_role');
        const queued = await client.query(
          'SELECT public.queue_expired_file_upload_cleanup(clock_timestamp()) AS result',
        );
        assert.equal(queued.rows[0].result.uploadSessionsQueued, 2);
        assert.equal(queued.rows[0].result.uploadSessionsQuarantined, 1);

        const claimed = await client.query(
          `SELECT * FROM public.claim_file_upload_cleanup_batch(
             10, 60, clock_timestamp()
           )`,
        );
        assert.equal(claimed.rowCount, 1);
        assert.equal(claimed.rows[0].session_id, expiredSessionId);
        assert.equal(claimed.rows[0].bucket_id, 'smart-job-company-files');
        assert.deepEqual(claimed.rows[0].object_paths, [expiredUpload.objectPath]);
        assert.equal(claimed.rows[0].attempt_count, 1);

        const noDuplicateClaim = await client.query(
          `SELECT * FROM public.claim_file_upload_cleanup_batch(
             10, 60, clock_timestamp()
           )`,
        );
        assert.equal(noDuplicateClaim.rowCount, 0);

        const failed = await client.query(
          `SELECT public.finish_file_upload_cleanup(
             $1, 1, false, $2, clock_timestamp()
           ) AS result`,
          [expiredSessionId, 'x'.repeat(700)],
        );
        assert.equal(failed.rows[0].result.outcome, 'cleanup_pending');

        const retried = await client.query(
          `SELECT * FROM public.claim_file_upload_cleanup_batch(
             10, 60, clock_timestamp()
           )`,
        );
        assert.equal(retried.rowCount, 1);
        assert.equal(retried.rows[0].session_id, expiredSessionId);
        assert.equal(retried.rows[0].attempt_count, 2);

        const completed = await client.query(
          `SELECT public.finish_file_upload_cleanup(
             $1, 2, true, NULL, clock_timestamp()
           ) AS result`,
          [expiredSessionId],
        );
        assert.equal(completed.rows[0].result.outcome, 'cleanup_complete');
        await client.query('RESET ROLE');

        const states = await client.query(
          `SELECT id, status, cleanup_attempts,
                  char_length(last_cleanup_error) AS error_length
           FROM private.file_upload_sessions
           WHERE id = ANY($1::uuid[])
           ORDER BY id`,
          [[expiredSessionId, consumedSessionId, crossPrefixSessionId]],
        );
        const byId = new Map(states.rows.map((row) => [row.id, row]));
        assert.deepEqual(byId.get(expiredSessionId), {
          id: expiredSessionId,
          status: 'cleanup_complete',
          cleanup_attempts: 2,
          error_length: null,
        });
        assert.deepEqual(byId.get(consumedSessionId), {
          id: consumedSessionId,
          status: 'consumed',
          cleanup_attempts: 0,
          error_length: null,
        });
        assert.deepEqual(byId.get(crossPrefixSessionId), {
          id: crossPrefixSessionId,
          status: 'cleanup_failed',
          cleanup_attempts: 5,
          error_length: 31,
        });
      });
    });

    it('uses skip-locked leases so concurrent workers claim different sessions', async () => {
      const sessionIds = [randomUUID(), randomUUID()];
      await withClient(async (client) => {
        for (const sessionId of sessionIds) {
          await insertCleanupSession(client, {
            sessionId,
            upload: cleanupUploadManifest(sessionId),
            status: 'cleanup_pending',
          });
        }
      });

      const first = databaseClient();
      const second = databaseClient();
      await Promise.all([first.connect(), second.connect()]);
      try {
        await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
        await Promise.all([
          first.query('SET LOCAL ROLE service_role'),
          second.query('SET LOCAL ROLE service_role'),
        ]);
        const firstClaim = await first.query(
          'SELECT * FROM public.claim_file_upload_cleanup_batch(1, 60, clock_timestamp())',
        );
        const secondClaim = await second.query(
          'SELECT * FROM public.claim_file_upload_cleanup_batch(1, 60, clock_timestamp())',
        );
        assert.equal(firstClaim.rowCount, 1);
        assert.equal(secondClaim.rowCount, 1);
        assert.notEqual(
          firstClaim.rows[0].session_id,
          secondClaim.rows[0].session_id,
        );
      } finally {
        await Promise.all([
          first.query('ROLLBACK').catch(() => undefined),
          second.query('ROLLBACK').catch(() => undefined),
        ]);
        await Promise.all([first.end(), second.end()]);
        await withClient((client) => client.query(
          'DELETE FROM private.file_upload_sessions WHERE id = ANY($1::uuid[])',
          [sessionIds],
        ));
      }
    });

    it('dead-letters the fifth failed deletion with a bounded error', async () => {
      await withTransaction(async (client) => {
        const sessionId = randomUUID();
        await insertCleanupSession(client, {
          sessionId,
          upload: cleanupUploadManifest(sessionId),
          status: 'cleanup_pending',
          cleanupAttempts: 4,
        });
        await client.query('SET LOCAL ROLE service_role');
        const claim = await client.query(
          'SELECT * FROM public.claim_file_upload_cleanup_batch(10, 60, clock_timestamp())',
        );
        assert.equal(claim.rows[0].session_id, sessionId);
        assert.equal(claim.rows[0].attempt_count, 5);
        const finish = await client.query(
          `SELECT public.finish_file_upload_cleanup(
             $1, 5, false, 'permanent storage failure', clock_timestamp()
           ) AS result`,
          [sessionId],
        );
        assert.equal(finish.rows[0].result.outcome, 'cleanup_failed');
      });
    });
  });

  describe('hardened API business registration', {
    concurrency: false,
    timeout: 60_000,
  }, () => {
    const registrationFunction = `private.register_api_business_account(
      text,text,text,text,text,text,text,text,text,text,text,text,text,text,text
    )`;

    async function registerAccount(client, userId, options = {}) {
      const value = (name, fallback) => Object.hasOwn(options, name)
        ? options[name]
        : fallback;
      await setRuntimeContext(client, userId);
      return client.query(
        `SELECT * FROM private.register_api_business_account(
          $1::text, $2::text, $3::text, $4::text, $5::text,
          $6::text, $7::text, $8::text, $9::text, $10::text,
          $11::text, $12::text, $13::text, $14::text, $15::text
        )`,
        [
          value('email', `registration-${userId}@example.invalid`),
          value('mode', 'business'),
          value('displayName', 'Registration Manager'),
          value('phoneNumber', '+972500000000'),
          value('companyName', 'Registration Company'),
          value('englishName', 'Registration Company'),
          value('vatNumber', String(700000000 + randomInt(100000000))),
          value('businessType', 'Field service'),
          value('city', 'Haifa'),
          value('address', '1 Registration Road'),
          value('businessPhone', '+97235550000'),
          value('businessFax', null),
          value('accountantName', null),
          value('accountantEmail', null),
          value('accountantPhone', null),
        ],
      );
    }

    it('grants only the runtime API role access to the identity-derived function', async () => {
      await withClient(async (client) => {
        const privileges = await client.query(
          `SELECT
             has_function_privilege('smart_job_api', $1, 'EXECUTE') AS api_can_execute,
             has_function_privilege('anon', $1, 'EXECUTE') AS anon_can_execute,
             has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_can_execute,
             has_function_privilege('service_role', $1, 'EXECUTE') AS service_can_execute`,
          [registrationFunction],
        );
        assert.deepEqual(privileges.rows[0], {
          api_can_execute: true,
          anon_can_execute: false,
          auth_can_execute: false,
          service_can_execute: false,
        });
      });
    });

    it('derives company identity, owner role, tier, and modules in one transaction', async () => {
      await withTransaction(async (client) => {
        const userId = randomUUID();
        const created = await registerAccount(client, userId, {
          vatNumber: '799000001',
        });
        assert.equal(created.rowCount, 1);
        assert.equal(created.rows[0].tier, 'Team');
        assert.ok(Number(created.rows[0].public_company_id) >= 1001);

        const stored = await client.query(
          `SELECT
             company.account_type::text AS account_type,
             company.created_by_user_id,
             profile.business_email,
             profile.vat_number,
             subscription.tier::text AS tier,
             subscription.enabled_modules,
             membership.user_id,
             membership.member_no,
             membership.role::text AS role,
             sync.workers_version
           FROM public.companies AS company
           INNER JOIN public.company_profiles AS profile ON profile.company_id = company.id
           INNER JOIN public.company_subscriptions AS subscription ON subscription.company_id = company.id
           INNER JOIN public.company_memberships AS membership ON membership.company_id = company.id
           INNER JOIN public.company_sync_state AS sync ON sync.company_id = company.id
           WHERE company.id = $1`,
          [created.rows[0].internal_company_id],
        );
        assert.equal(stored.rowCount, 1);
        assert.equal(stored.rows[0].account_type, 'business');
        assert.equal(stored.rows[0].created_by_user_id, userId);
        assert.equal(stored.rows[0].business_email, `registration-${userId}@example.invalid`);
        assert.equal(stored.rows[0].vat_number, '799000001');
        assert.equal(stored.rows[0].tier, 'Team');
        assert.equal(stored.rows[0].enabled_modules.team, true);
        assert.equal(stored.rows[0].enabled_modules.clients, true);
        assert.equal(stored.rows[0].user_id, userId);
        assert.equal(stored.rows[0].member_no, 1);
        assert.equal(stored.rows[0].role, 'manager');
        assert.equal(stored.rows[0].workers_version, 1);

        await client.query('SAVEPOINT duplicate_registration');
        await expectDatabaseError(
          registerAccount(client, userId, { vatNumber: '799000002' }),
          'P0001',
          /ONBOARDING_ALREADY_COMPLETED/,
        );
        await client.query('ROLLBACK TO SAVEPOINT duplicate_registration');
      });
    });

    it('rolls back the user, company, and system counter when a unique profile write fails', async () => {
      await withTransaction(async (client) => {
        const firstUser = randomUUID();
        const secondUser = randomUUID();
        const vatNumber = '799000003';
        await registerAccount(client, firstUser, { vatNumber });
        await client.query('RESET ROLE');
        const counterBefore = await client.query(
          `SELECT next_value FROM public.system_counters
           WHERE counter_key = 'public_company_id'`,
        );

        await client.query('SAVEPOINT conflicting_registration');
        await expectDatabaseError(
          registerAccount(client, secondUser, { vatNumber }),
          '23505',
          /company_profiles_vat_number_unique/,
        );
        await client.query('ROLLBACK TO SAVEPOINT conflicting_registration');
        await client.query('RESET ROLE');

        const secondUserRows = await client.query(
          'SELECT id FROM public.app_users WHERE id = $1',
          [secondUser],
        );
        const secondCompanies = await client.query(
          'SELECT id FROM public.companies WHERE created_by_user_id = $1',
          [secondUser],
        );
        const counterAfter = await client.query(
          `SELECT next_value FROM public.system_counters
           WHERE counter_key = 'public_company_id'`,
        );
        assert.equal(secondUserRows.rowCount, 0);
        assert.equal(secondCompanies.rowCount, 0);
        assert.deepEqual(counterAfter.rows, counterBefore.rows);
      });
    });

    it('maps basic and solo modes to fixed roles and subscriptions', async () => {
      for (const [mode, expectedRole, expectedTier] of [
        ['basic', 'basic', 'Basic'],
        ['solo', 'user', 'Solo'],
      ]) {
        await withTransaction(async (client) => {
          const userId = randomUUID();
          const created = await registerAccount(client, userId, {
            mode,
            companyName: null,
            englishName: null,
            vatNumber: null,
            businessType: null,
            address: null,
            businessPhone: null,
          });
          const membership = await client.query(
            `SELECT membership.role::text AS role, subscription.tier::text AS tier
             FROM public.company_memberships AS membership
             INNER JOIN public.company_subscriptions AS subscription
               ON subscription.company_id = membership.company_id
             WHERE membership.company_id = $1`,
            [created.rows[0].internal_company_id],
          );
          assert.deepEqual(membership.rows[0], {
            role: expectedRole,
            tier: expectedTier,
          });
        });
      }
    });
  });

  describe('authenticated API push-device mutations', {
    concurrency: false,
    timeout: 60_000,
  }, () => {
    const registerFunction = 'private.register_api_push_device(text,text,text)';
    const clearFunction = 'private.clear_api_push_device(text)';

    it('grants only the runtime API role access without direct table writes', async () => {
      await withClient(async (client) => {
        const privileges = await client.query(
          `SELECT
             has_function_privilege('smart_job_api', $1, 'EXECUTE') AS api_can_register,
             has_function_privilege('smart_job_api', $2, 'EXECUTE') AS api_can_clear,
             has_function_privilege('anon', $1, 'EXECUTE') AS anon_can_register,
             has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_can_register,
             has_function_privilege('service_role', $1, 'EXECUTE') AS service_can_register,
             has_function_privilege('service_role', $2, 'EXECUTE') AS service_can_clear,
             has_table_privilege('smart_job_api', 'private.push_devices', 'SELECT') AS api_can_read_table,
             has_function_privilege('smart_job_api', 'private.upsert_api_push_token(text,text)', 'EXECUTE') AS api_can_use_legacy_upsert`,
          [registerFunction, clearFunction],
        );
        assert.deepEqual(privileges.rows[0], {
          api_can_register: true,
          api_can_clear: true,
          anon_can_register: false,
          auth_can_register: false,
          service_can_register: false,
          service_can_clear: false,
          api_can_read_table: false,
          api_can_use_legacy_upsert: false,
        });
      });
    });

    it('supports multiple devices, transfers recycled tokens, and clears only one installation', async () => {
      await withTransaction(async (client) => {
        const contextUser = randomUUID();
        const otherUser = randomUUID();
        await client.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES
             ($1, $2, 'Push context user'),
             ($3, $4, 'Push other user')`,
          [
            contextUser,
            `push-context-${contextUser}@example.invalid`,
            otherUser,
            `push-other-${otherUser}@example.invalid`,
          ],
        );

        await setRuntimeContext(client, contextUser);
        const registeredA = await client.query(
          `SELECT * FROM private.register_api_push_device($1::text, $2::text, $3::text)`,
          ['install-context-device-a', 'shared-provider-token-123456', 'ios'],
        );
        assert.equal(registeredA.rowCount, 1);
        assert.equal(registeredA.rows[0].push_token_platform, 'ios');
        assert.ok(registeredA.rows[0].push_token_updated_at instanceof Date);
        await client.query(
          `SELECT * FROM private.register_api_push_device($1::text, $2::text, $3::text)`,
          ['install-context-device-b', 'context-device-b-token-123456', 'android'],
        );

        await client.query('RESET ROLE');
        const contextDevices = await client.query(
          `SELECT user_id, push_token, platform
           FROM private.push_devices
           WHERE user_id = $1
           ORDER BY push_token`,
          [contextUser],
        );
        assert.deepEqual(contextDevices.rows, [
          { user_id: contextUser, push_token: 'context-device-b-token-123456', platform: 'android' },
          { user_id: contextUser, push_token: 'shared-provider-token-123456', platform: 'ios' },
        ]);

        await setRuntimeContext(client, otherUser);
        await client.query(
          `SELECT * FROM private.register_api_push_device($1::text, $2::text, $3::text)`,
          ['install-other-device-a', 'shared-provider-token-123456', 'android'],
        );
        await client.query('RESET ROLE');
        const afterTransfer = await client.query(
          `SELECT user_id, push_token, platform
           FROM private.push_devices
           WHERE user_id IN ($1, $2)
           ORDER BY push_token`,
          [contextUser, otherUser],
        );
        assert.deepEqual(afterTransfer.rows, [
          { user_id: contextUser, push_token: 'context-device-b-token-123456', platform: 'android' },
          { user_id: otherUser, push_token: 'shared-provider-token-123456', platform: 'android' },
        ]);

        await setRuntimeContext(client, otherUser);
        const cleared = await client.query(
          `SELECT private.clear_api_push_device($1::text) AS cleared`,
          ['install-other-device-a'],
        );
        assert.equal(cleared.rows[0].cleared, true);
        const clearedAgain = await client.query(
          `SELECT private.clear_api_push_device($1::text) AS cleared`,
          ['install-other-device-a'],
        );
        assert.equal(clearedAgain.rows[0].cleared, true);
        await client.query('RESET ROLE');
        const afterClear = await client.query(
          `SELECT user_id, push_token
           FROM private.push_devices
           ORDER BY push_token`,
        );
        assert.deepEqual(afterClear.rows, [
          { user_id: contextUser, push_token: 'context-device-b-token-123456' },
        ]);
      });
    });

    it('raises a stable not-found error when registration has no app-user row', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, randomUUID());
        await expectDatabaseError(
          client.query(
            `SELECT * FROM private.register_api_push_device($1::text, $2::text, $3::text)`,
            ['install-missing-user-a', 'missing-user-token-123456', 'android'],
          ),
          'P0002',
          /PUSH_DEVICE_USER_NOT_FOUND/,
        );
      });
    });

    it('keeps clear successful when the app-user row is already absent', async () => {
      await withTransaction(async (client) => {
        await setRuntimeContext(client, randomUUID());
        const result = await client.query(
          `SELECT private.clear_api_push_device($1::text) AS cleared`,
          ['install-missing-user-a'],
        );
        assert.equal(result.rows[0].cleared, true);
      });
    });
  });

  describe('hardened API invitations', {
    concurrency: false,
    timeout: 60_000,
  }, () => {
    const createFunction = 'private.create_api_company_invitation(uuid,text,text,integer)';
    const redeemFunction = 'private.redeem_api_company_invitation(bigint,text,text,text)';
    const rateLimitFunction = 'private.consume_api_invitation_rate_limit(text)';

    async function insertInvitationAuthUser(client, userId, email, verified = true) {
      await client.query(
        `INSERT INTO auth.users (
           id, aud, role, email, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at
         ) VALUES (
           $1, 'authenticated', 'authenticated', $2, $3,
           '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
         )`,
        [userId, email, verified ? new Date() : null],
      );
    }

    async function insertInvitationCompany(client, input) {
      await insertInvitationAuthUser(
        client,
        input.managerUser,
        input.managerEmail,
        input.managerVerified ?? true,
      );
      await client.query(
        `INSERT INTO public.app_users (id, email, display_name)
         VALUES ($1, $2, 'Invitation manager')`,
        [input.managerUser, input.managerEmail],
      );
      await client.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES ($1, $2, 'business', 'active', $3)`,
        [input.company, input.publicCompanyId, input.managerUser],
      );
      await client.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES ($1, 'Team', 'active', '{"team":true}'::jsonb)`,
        [input.company],
      );
      await client.query(
        `INSERT INTO public.company_sync_state (company_id)
         VALUES ($1)`,
        [input.company],
      );
      await client.query(
        `INSERT INTO public.company_counters (
           company_id, counter_key, next_value
         ) VALUES ($1, 'member_no', 2)`,
        [input.company],
      );
      await client.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES ($1, $2, $3, 1, 'manager', 'active', 'Invitation manager')`,
        [input.managerMembership, input.company, input.managerUser],
      );
    }

    async function createInvitation(client, input) {
      await setRuntimeContext(client, input.managerUser);
      const created = await client.query(
        `SELECT * FROM private.create_api_company_invitation(
           $1::uuid, $2::text, $3::text, $4::integer
         )`,
        [
          input.company,
          input.targetRole ?? 'worker',
          input.targetEmail ?? null,
          input.expiresInDays ?? 30,
        ],
      );
      assert.equal(created.rowCount, 1);
      return created.rows[0];
    }

    async function redeemInvitation(client, input) {
      await setRuntimeContext(client, input.userId);
      return client.query(
        `SELECT * FROM private.redeem_api_company_invitation(
           $1::bigint, $2::text, $3::text, $4::text
         )`,
        [
          input.publicCompanyId,
          input.inviteCode,
          input.displayName ?? null,
          input.phoneNumber ?? null,
        ],
      );
    }

    it('grants only the runtime API role access without direct public writes', async () => {
      await withClient(async (client) => {
        const privileges = await client.query(
          `SELECT
             has_function_privilege('smart_job_api', $1, 'EXECUTE') AS api_can_create,
             has_function_privilege('smart_job_api', $2, 'EXECUTE') AS api_can_redeem,
             has_function_privilege('smart_job_api', $3, 'EXECUTE') AS api_can_rate_limit,
             has_function_privilege('anon', $1, 'EXECUTE') AS anon_can_create,
             has_function_privilege('authenticated', $2, 'EXECUTE') AS auth_can_redeem,
             has_function_privilege('authenticated', $3, 'EXECUTE') AS auth_can_rate_limit,
             has_function_privilege('service_role', $1, 'EXECUTE') AS service_can_create,
             has_function_privilege('service_role', $2, 'EXECUTE') AS service_can_redeem,
             has_function_privilege('service_role', $3, 'EXECUTE') AS service_can_rate_limit,
             has_table_privilege('smart_job_api', 'public.company_invites', 'INSERT') AS api_can_insert_invite,
             has_table_privilege('smart_job_api', 'public.rate_limit_buckets', 'INSERT') AS api_can_insert_rate_limit,
             has_table_privilege('smart_job_api', 'public.company_memberships', 'INSERT') AS api_can_insert_member`,
          [createFunction, redeemFunction, rateLimitFunction],
        );
        assert.deepEqual(privileges.rows[0], {
          api_can_create: true,
          api_can_redeem: true,
          api_can_rate_limit: true,
          anon_can_create: false,
          auth_can_redeem: false,
          auth_can_rate_limit: false,
          service_can_create: false,
          service_can_redeem: false,
          service_can_rate_limit: false,
          api_can_insert_invite: false,
          api_can_insert_rate_limit: false,
          api_can_insert_member: false,
        });
      });
    });

    it('commits separate hashed 10-per-minute create and redeem decisions', async () => {
      await withTransaction(async (client) => {
        const userId = randomUUID();
        await setRuntimeContext(client, userId);

        let createResetAt;
        for (let index = 0; index < 11; index += 1) {
          const decision = await client.query(
            `SELECT * FROM private.consume_api_invitation_rate_limit('create')`,
          );
          assert.equal(decision.rowCount, 1);
          assert.equal(decision.rows[0].allowed, index < 10);
          createResetAt ??= decision.rows[0].reset_at;
          assert.equal(
            new Date(decision.rows[0].reset_at).toISOString(),
            new Date(createResetAt).toISOString(),
          );
        }

        const redeemDecision = await client.query(
          `SELECT * FROM private.consume_api_invitation_rate_limit('redeem')`,
        );
        assert.equal(redeemDecision.rows[0].allowed, true);
        assert.equal(
          new Date(redeemDecision.rows[0].reset_at).toISOString(),
          new Date(createResetAt).toISOString(),
        );
        await client.query('RESET ROLE');

        const stored = await client.query(
          `WITH expected AS (
             SELECT encode(
               extensions.digest(
                 convert_to('invitation:' || operation || ':' || $1, 'UTF8'),
                 'sha256'
               ),
               'hex'
             ) AS hashed_key
             FROM unnest(ARRAY['create', 'redeem']) AS operations(operation)
           )
           SELECT
             COUNT(DISTINCT bucket.hashed_key)::integer AS operation_count,
             SUM(bucket.hit_count)::integer AS total_hits,
             bool_and(bucket.bucket_key ~ '^[0-9a-f]{64}$') AS bucket_keys_are_hashes,
             bool_and(bucket.hashed_key ~ '^[0-9a-f]{64}$') AS subject_keys_are_hashes,
             bool_and(position($1 IN bucket.bucket_key) = 0) AS no_raw_uid_in_bucket
           FROM public.rate_limit_buckets AS bucket
           INNER JOIN expected USING (hashed_key)`,
          [userId],
        );
        assert.deepEqual(stored.rows[0], {
          operation_count: 2,
          total_hits: 12,
          bucket_keys_are_hashes: true,
          subject_keys_are_hashes: true,
          no_raw_uid_in_bucket: true,
        });
      });
    });

    it('binds verified Auth email, permits another workspace, and replays the same consumed invite', async () => {
      await withTransaction(async (client) => {
        const managerUser = randomUUID();
        const managerMembership = randomUUID();
        const company = randomUUID();
        const publicCompanyId = publicCompanyBase + 300;
        const targetUser = randomUUID();
        const targetEmail = `${'a'.repeat(210)}@example.test`;
        const otherCompany = randomUUID();

        await insertInvitationCompany(client, {
          managerUser,
          managerEmail: `invite-manager-${managerUser}@example.invalid`,
          managerMembership,
          company,
          publicCompanyId,
        });
        await insertInvitationAuthUser(client, targetUser, targetEmail);
        await client.query(
          `INSERT INTO public.app_users (id, email)
           VALUES ($1, $2)`,
          [targetUser, targetEmail],
        );
        await client.query(
          `INSERT INTO public.companies (
             id, public_company_id, account_type, status, created_by_user_id
           ) VALUES ($1, $2, 'business', 'active', $3)`,
          [otherCompany, publicCompanyId + 1, targetUser],
        );
        await client.query(
          `INSERT INTO public.company_memberships (
             company_id, user_id, member_no, role, status
           ) VALUES ($1, $2, 1, 'manager', 'active')`,
          [otherCompany, targetUser],
        );

        const invitation = await createInvitation(client, {
          managerUser,
          company,
          targetEmail,
        });
        assert.match(invitation.invite_code, /^[A-F0-9]{20}$/);
        assert.equal(invitation.target_role, 'worker');
        await client.query('RESET ROLE');

        const redeemed = await redeemInvitation(client, {
          userId: targetUser,
          publicCompanyId,
          inviteCode: invitation.invite_code.toLowerCase(),
        });
        assert.equal(redeemed.rowCount, 1);
        assert.equal(redeemed.rows[0].public_company_id, String(publicCompanyId));
        assert.equal(redeemed.rows[0].role, 'worker');
        assert.equal(redeemed.rows[0].display_name.length, 200);
        assert.equal(redeemed.rows[0].display_name, targetEmail.slice(0, 200));
        const firstMembershipId = redeemed.rows[0].membership_id;
        await client.query('RESET ROLE');

        const stored = await client.query(
          `SELECT
             invitation.status::text AS invitation_status,
             invitation.used_by_user_id,
             membership.invited_by_user_id,
             membership.display_name,
             sync.workers_version,
             location.location_type::text AS location_type
           FROM public.company_invites AS invitation
           INNER JOIN public.company_memberships AS membership
             ON membership.id = $2
           INNER JOIN public.company_sync_state AS sync
             ON sync.company_id = invitation.company_id
           INNER JOIN public.inventory_locations AS location
             ON location.membership_id = membership.id
           WHERE invitation.id = $1`,
          [invitation.invite_id, firstMembershipId],
        );
        assert.deepEqual(stored.rows[0], {
          invitation_status: 'used',
          used_by_user_id: targetUser,
          invited_by_user_id: managerUser,
          display_name: targetEmail.slice(0, 200),
          workers_version: 1,
          location_type: 'member',
        });
        const memberships = await client.query(
          `SELECT company_id FROM public.company_memberships
           WHERE user_id = $1 AND status = 'active'`,
          [targetUser],
        );
        assert.equal(memberships.rowCount, 2);

        await client.query(
          `UPDATE public.company_invites
           SET expires_at = clock_timestamp() - interval '1 day'
           WHERE id = $1`,
          [invitation.invite_id],
        );
        const replayed = await redeemInvitation(client, {
          userId: targetUser,
          publicCompanyId,
          inviteCode: invitation.invite_code,
          displayName: 'Ignored replay name',
        });
        assert.equal(replayed.rows[0].membership_id, firstMembershipId);
        await client.query('RESET ROLE');
        const afterReplay = await client.query(
          `SELECT COUNT(*)::integer AS membership_count
           FROM public.company_memberships
           WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
          [company, targetUser],
        );
        assert.equal(afterReplay.rows[0].membership_count, 1);
      });
    });

    it('keeps the invite and membership state unchanged on email or target-membership conflicts', async () => {
      await withTransaction(async (client) => {
        const managerUser = randomUUID();
        const managerMembership = randomUUID();
        const company = randomUUID();
        const publicCompanyId = publicCompanyBase + 310;
        const targetUser = randomUUID();
        const targetEmail = `wrong-invite-${targetUser}@example.invalid`;

        await insertInvitationCompany(client, {
          managerUser,
          managerEmail: `invite-manager-${managerUser}@example.invalid`,
          managerMembership,
          company,
          publicCompanyId,
        });
        await insertInvitationAuthUser(client, targetUser, targetEmail);
        await client.query(
          `INSERT INTO public.app_users (id, email)
           VALUES ($1, $2)`,
          [targetUser, targetEmail],
        );
        const restricted = await createInvitation(client, {
          managerUser,
          company,
          targetEmail: `different-${targetUser}@example.invalid`,
        });
        await client.query('RESET ROLE');

        await client.query('SAVEPOINT email_mismatch');
        await expectDatabaseError(
          redeemInvitation(client, {
            userId: targetUser,
            publicCompanyId,
            inviteCode: restricted.invite_code,
          }),
          '42501',
          /INVITATION_EMAIL_MISMATCH/,
        );
        await client.query('ROLLBACK TO SAVEPOINT email_mismatch');

        const unrestricted = await createInvitation(client, {
          managerUser,
          company,
        });
        await client.query('RESET ROLE');
        await client.query('SAVEPOINT membership_exists');
        await expectDatabaseError(
          redeemInvitation(client, {
            userId: managerUser,
            publicCompanyId,
            inviteCode: unrestricted.invite_code,
          }),
          'P0001',
          /WORKSPACE_MEMBERSHIP_EXISTS/,
        );
        await client.query('ROLLBACK TO SAVEPOINT membership_exists');

        const states = await client.query(
          `SELECT id, status::text AS status, used_by_user_id
           FROM public.company_invites
           WHERE id = ANY($1::uuid[])
           ORDER BY id`,
          [[restricted.invite_id, unrestricted.invite_id]],
        );
        assert.equal(states.rowCount, 2);
        for (const row of states.rows) {
          assert.equal(row.status, 'active');
          assert.equal(row.used_by_user_id, null);
        }
        const sync = await client.query(
          `SELECT workers_version FROM public.company_sync_state
           WHERE company_id = $1`,
          [company],
        );
        assert.equal(sync.rows[0].workers_version, 0);
      });
    });

    it('requires a verified Auth email before invitation creation', async () => {
      await withTransaction(async (client) => {
        const managerUser = randomUUID();
        const company = randomUUID();
        await insertInvitationCompany(client, {
          managerUser,
          managerEmail: `unverified-manager-${managerUser}@example.invalid`,
          managerVerified: false,
          managerMembership: randomUUID(),
          company,
          publicCompanyId: publicCompanyBase + 320,
        });
        await client.query('SAVEPOINT unverified_manager');
        await expectDatabaseError(
          createInvitation(client, { managerUser, company }),
          '42501',
          /EMAIL_VERIFICATION_REQUIRED/,
        );
        await client.query('ROLLBACK TO SAVEPOINT unverified_manager');
        const invites = await client.query(
          'SELECT id FROM public.company_invites WHERE company_id = $1',
          [company],
        );
        assert.equal(invites.rowCount, 0);
      });
    });

    it('locks one invite so concurrent different users produce exactly one membership', async () => {
      const managerUser = randomUUID();
      const managerMembership = randomUUID();
      const company = randomUUID();
      const publicCompanyId = publicCompanyBase + 330;
      const firstUser = randomUUID();
      const secondUser = randomUUID();
      let invitation;

      try {
        await withClient(async (client) => {
          await client.query('BEGIN');
          try {
            await insertInvitationCompany(client, {
              managerUser,
              managerEmail: `concurrent-manager-${managerUser}@example.invalid`,
              managerMembership,
              company,
              publicCompanyId,
            });
            for (const userId of [firstUser, secondUser]) {
              const email = `concurrent-invite-${userId}@example.invalid`;
              await insertInvitationAuthUser(client, userId, email);
              await client.query(
                `INSERT INTO public.app_users (id, email)
                 VALUES ($1, $2)`,
                [userId, email],
              );
            }
            invitation = await createInvitation(client, { managerUser, company });
            await client.query('RESET ROLE');
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        });

        const first = databaseClient();
        const second = databaseClient();
        await Promise.all([first.connect(), second.connect()]);
        try {
          await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
          await Promise.all([
            setRuntimeContext(first, firstUser),
            setRuntimeContext(second, secondUser),
          ]);

          const firstResult = await first.query(
            `SELECT * FROM private.redeem_api_company_invitation(
               $1::bigint, $2::text, NULL, NULL
             )`,
            [publicCompanyId, invitation.invite_code],
          );
          assert.equal(firstResult.rowCount, 1);
          const secondAttempt = second.query(
            `SELECT * FROM private.redeem_api_company_invitation(
               $1::bigint, $2::text, NULL, NULL
             )`,
            [publicCompanyId, invitation.invite_code],
          );
          await first.query('COMMIT');
          await expectDatabaseError(
            secondAttempt,
            'P0001',
            /INVITATION_ALREADY_USED/,
          );
        } finally {
          await Promise.all([
            first.query('ROLLBACK').catch(() => undefined),
            second.query('ROLLBACK').catch(() => undefined),
          ]);
          await Promise.all([first.end(), second.end()]);
        }

        await withClient(async (client) => {
          const state = await client.query(
            `SELECT
               invitation.used_by_user_id,
               sync.workers_version,
               COUNT(membership.id)::integer AS joined_memberships
             FROM public.company_invites AS invitation
             INNER JOIN public.company_sync_state AS sync
               ON sync.company_id = invitation.company_id
             LEFT JOIN public.company_memberships AS membership
               ON membership.company_id = invitation.company_id
              AND membership.user_id IN ($2, $3)
              AND membership.status = 'active'
             WHERE invitation.id = $1
             GROUP BY invitation.used_by_user_id, sync.workers_version`,
            [invitation.invite_id, firstUser, secondUser],
          );
          assert.equal(state.rows[0].used_by_user_id, firstUser);
          assert.equal(state.rows[0].workers_version, 1);
          assert.equal(state.rows[0].joined_memberships, 1);
        });
      } finally {
        await withClient(async (client) => {
          await client.query('DELETE FROM public.companies WHERE id = $1', [company])
            .catch(() => undefined);
          await client.query(
            'DELETE FROM public.app_users WHERE id = ANY($1::text[])',
            [[managerUser, firstUser, secondUser]],
          ).catch(() => undefined);
          await client.query(
            'DELETE FROM auth.users WHERE id = ANY($1::uuid[])',
            [[managerUser, firstUser, secondUser]],
          ).catch(() => undefined);
        });
      }
    });
  });

  describe('production workflow foundations', { concurrency: false, timeout: 60_000 }, () => {
    async function insertWorkflowCompany(client, { userId, companyId, membershipId, publicCompanyId }) {
      await client.query(
        `INSERT INTO public.app_users (id, email, display_name)
         VALUES ($1, $2, 'Workflow Manager')`,
        [userId, `workflow-${userId}@example.invalid`],
      );
      await client.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES ($1, $2, 'business', 'active', $3)`,
        [companyId, publicCompanyId, userId],
      );
      await client.query(
        `INSERT INTO public.company_sync_state (company_id) VALUES ($1)`,
        [companyId],
      );
      await client.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES (
           $1, 'Team', 'active',
           '{"jobs":true,"inventory":true,"documents":true}'::jsonb
         )`,
        [companyId],
      );
      await client.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES ($1, $2, $3, 1, 'manager', 'active', 'Workflow Manager')`,
        [membershipId, companyId, userId],
      );
      await client.query(
        `INSERT INTO public.company_profiles (
           company_id, he_name, business_email, vat_number
         ) VALUES ($1, 'Workflow Company', $2, '515000001')`,
        [companyId, `company-${companyId}@example.invalid`],
      );
    }

    function taxDocumentData(suffix = '') {
      return {
        client: {
          name: `Tax Client ${suffix}`.trim(),
          email: `tax-client-${suffix || 'base'}@example.invalid`,
        },
        items: [{ description: 'Field service', quantity: 1, price: 100 }],
        language: 'he',
        date: '2026-07-18T12:00:00.000Z',
      };
    }

    it('enforces the worker-role permission matrix without direct ERP table writes', async () => {
      await withClient(async (client) => {
        const roles = ['anon', 'authenticated', 'service_role', 'smart_job_api', 'smart_job_pdf', 'smart_job_email', 'smart_job_archiver'];
        const result = await client.query(
          `SELECT role_name,
             has_table_privilege(role_name, 'public.documents', 'INSERT,UPDATE,DELETE') AS public_document_write,
             has_table_privilege(role_name, 'private.document_email_deliveries', 'SELECT,INSERT,UPDATE,DELETE') AS email_table_access,
             has_table_privilege(role_name, 'private.tax_submissions', 'SELECT,INSERT,UPDATE,DELETE') AS tax_table_access,
             has_function_privilege(role_name, 'private.claim_pdf_document_task(text,uuid,integer)', 'EXECUTE') AS pdf_claim,
             has_function_privilege(role_name, 'private.claim_email_delivery(uuid,uuid,integer)', 'EXECUTE') AS email_claim,
             has_function_privilege(role_name, 'private.claim_archive_run_lease(uuid,text,text,timestamptz,uuid,integer)', 'EXECUTE') AS archive_claim,
             has_function_privilege(role_name, 'private.create_api_tax_invoice(uuid,jsonb,timestamptz)', 'EXECUTE') AS tax_create
           FROM unnest($1::text[]) AS role_name
           ORDER BY role_name`,
          [roles],
        );
        for (const row of result.rows) {
          assert.equal(row.public_document_write, false, `${row.role_name} has direct document writes`);
          assert.equal(row.email_table_access, false, `${row.role_name} has direct email-table access`);
          assert.equal(row.tax_table_access, false, `${row.role_name} has direct tax-table access`);
          assert.equal(row.pdf_claim, row.role_name === 'smart_job_pdf');
          assert.equal(row.email_claim, row.role_name === 'smart_job_email');
          assert.equal(row.archive_claim, row.role_name === 'smart_job_archiver');
          assert.equal(row.tax_create, row.role_name === 'smart_job_api');
        }
      });
    });

    it('consumes accepted-job inventory exactly once and rolls back insufficient stock', async () => {
      await withTransaction(async (client) => {
        const userId = randomUUID();
        const companyId = randomUUID();
        const membershipId = randomUUID();
        const locationId = randomUUID();
        const partId = randomUUID();
        const acceptedJobId = randomUUID();
        const insufficientJobId = randomUUID();
        await insertWorkflowCompany(client, {
          userId,
          companyId,
          membershipId,
          publicCompanyId: publicCompanyBase + 900,
        });
        await client.query(
          `INSERT INTO public.inventory_locations (
             id, company_id, location_type, membership_id, name
           ) VALUES ($1, $2, 'member', $3, 'Manager stock')`,
          [locationId, companyId, membershipId],
        );
        await client.query(
          `INSERT INTO public.inventory_parts (id, company_id, part_no, name)
           VALUES ($1, $2, 1, 'Replacement part')`,
          [partId, companyId],
        );
        await client.query(
          `INSERT INTO public.inventory_balances (location_id, part_id, quantity_on_hand)
           VALUES ($1, $2, 5)`,
          [locationId, partId],
        );
        await client.query(
          `INSERT INTO public.jobs (
             id, company_id, job_no, status, title,
             assigned_membership_id, created_by_membership_id
           ) VALUES
             ($1, $3, 1, 'pending', 'Accept inventory', $4, $4),
             ($2, $3, 2, 'pending', 'Insufficient inventory', $4, $4)`,
          [acceptedJobId, insufficientJobId, companyId, membershipId],
        );
        await client.query(
          `INSERT INTO public.job_part_usages (
             job_id, inventory_part_id, part_name_snapshot, quantity
           ) VALUES ($1, $3, 'Replacement part', 2), ($2, $3, 'Replacement part', 10)`,
          [acceptedJobId, insufficientJobId, partId],
        );

        await setRuntimeContext(client, userId);
        const accepted = await client.query(
          `SELECT status, entity_version
           FROM private.accept_api_job($1::uuid, $2::uuid, 1, clock_timestamp())`,
          [companyId, acceptedJobId],
        );
        assert.equal(accepted.rows[0].status, 'finished');
        assert.equal(Number(accepted.rows[0].entity_version), 2);
        await client.query('RESET ROLE');
        const balances = await client.query(
          `SELECT location.location_type::text AS location_type, balance.quantity_on_hand::text AS quantity
           FROM public.inventory_balances AS balance
           INNER JOIN public.inventory_locations AS location ON location.id = balance.location_id
           WHERE balance.part_id = $1
           ORDER BY location.location_type`,
          [partId],
        );
        assert.deepEqual(balances.rows, [
          { location_type: 'member', quantity: '3.000' },
          { location_type: 'consumed', quantity: '2.000' },
        ]);
        const movements = await client.query(
          `SELECT count(*)::integer AS count
           FROM public.inventory_movements
           WHERE job_id = $1 AND movement_type = 'job_consumption'`,
          [acceptedJobId],
        );
        assert.equal(movements.rows[0].count, 1);

        await client.query('SAVEPOINT insufficient_accept');
        await setRuntimeContext(client, userId);
        await expectDatabaseError(
          client.query(
            `SELECT * FROM private.accept_api_job($1::uuid, $2::uuid, 1, clock_timestamp())`,
            [companyId, insufficientJobId],
          ),
          'P0001',
          /inventory_insufficient_stock/,
        );
        await client.query('ROLLBACK TO SAVEPOINT insufficient_accept');
        await client.query('RESET ROLE');
        const unchanged = await client.query(
          `SELECT job.status::text AS status, balance.quantity_on_hand::text AS quantity
           FROM public.jobs AS job
           CROSS JOIN public.inventory_balances AS balance
           WHERE job.id = $1 AND balance.location_id = $2 AND balance.part_id = $3`,
          [insufficientJobId, locationId, partId],
        );
        assert.deepEqual(unchanged.rows[0], { status: 'pending', quantity: '3.000' });
      });
    });

    it('serializes concurrent acceptance and consumes the job parts once', async () => {
      const userId = randomUUID();
      const companyId = randomUUID();
      const membershipId = randomUUID();
      const locationId = randomUUID();
      const partId = randomUUID();
      const jobId = randomUUID();
      const first = databaseClient();
      const second = databaseClient();
      try {
        await withClient(async (client) => {
          await insertWorkflowCompany(client, {
            userId,
            companyId,
            membershipId,
            publicCompanyId: publicCompanyBase + 903,
          });
          await client.query(
            `INSERT INTO public.inventory_locations (
               id, company_id, location_type, membership_id, name
             ) VALUES ($1, $2, 'member', $3, 'Concurrent manager stock')`,
            [locationId, companyId, membershipId],
          );
          await client.query(
            `INSERT INTO public.inventory_parts (id, company_id, part_no, name)
             VALUES ($1, $2, 1, 'Concurrent part')`,
            [partId, companyId],
          );
          await client.query(
            `INSERT INTO public.inventory_balances (location_id, part_id, quantity_on_hand)
             VALUES ($1, $2, 5)`,
            [locationId, partId],
          );
          await client.query(
            `INSERT INTO public.jobs (
               id, company_id, job_no, status, title,
               assigned_membership_id, created_by_membership_id
             ) VALUES ($1, $2, 1, 'pending', 'Concurrent acceptance', $3, $3)`,
            [jobId, companyId, membershipId],
          );
          await client.query(
            `INSERT INTO public.job_part_usages (
               job_id, inventory_part_id, part_name_snapshot, quantity
             ) VALUES ($1, $2, 'Concurrent part', 2)`,
            [jobId, partId],
          );
        });

        await Promise.all([first.connect(), second.connect()]);
        const accept = async (client) => {
          await client.query('BEGIN');
          try {
            await setRuntimeContext(client, userId);
            const accepted = await client.query(
              `SELECT status, entity_version
               FROM private.accept_api_job($1::uuid, $2::uuid, 1, clock_timestamp())`,
              [companyId, jobId],
            );
            await client.query('COMMIT');
            return accepted.rows[0];
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        };
        const attempts = await Promise.allSettled([accept(first), accept(second)]);
        const winners = attempts.filter((attempt) => attempt.status === 'fulfilled');
        const conflicts = attempts.filter((attempt) => attempt.status === 'rejected');
        assert.equal(winners.length, 1);
        assert.deepEqual(winners[0].value, { status: 'finished', entity_version: '2' });
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].reason?.code, '40001');
        assert.match(String(conflicts[0].reason?.message || ''), /ENTITY_VERSION_CONFLICT/);

        const stored = await withClient((client) => client.query(
          `SELECT job.status::text AS status,
                  balance.quantity_on_hand::text AS remaining,
                  (SELECT count(*)::integer FROM public.inventory_movements
                   WHERE job_id = $1 AND movement_type = 'job_consumption') AS movements
           FROM public.jobs AS job
           INNER JOIN public.inventory_balances AS balance
             ON balance.location_id = $2 AND balance.part_id = $3
           WHERE job.id = $1`,
          [jobId, locationId, partId],
        ));
        assert.deepEqual(stored.rows[0], {
          status: 'finished',
          remaining: '3.000',
          movements: 1,
        });
      } finally {
        await Promise.all([
          first.query('ROLLBACK').catch(() => undefined),
          second.query('ROLLBACK').catch(() => undefined),
        ]);
        await Promise.all([first.end().catch(() => undefined), second.end().catch(() => undefined)]);
        await withClient(async (client) => {
          await client.query('DELETE FROM public.companies WHERE id = $1', [companyId])
            .catch(() => undefined);
          await client.query('DELETE FROM public.app_users WHERE id = $1', [userId])
            .catch(() => undefined);
        });
      }
    });

    it('never queues a tax PDF before approval and processes replay-safe results', async () => {
      await withTransaction(async (client) => {
        const userId = randomUUID();
        const companyId = randomUUID();
        const membershipId = randomUUID();
        await insertWorkflowCompany(client, {
          userId,
          companyId,
          membershipId,
          publicCompanyId: publicCompanyBase + 901,
        });
        await setRuntimeContext(client, userId);
        const created = await client.query(
          `SELECT * FROM private.create_api_tax_invoice($1::uuid, $2::jsonb, clock_timestamp())`,
          [companyId, JSON.stringify(taxDocumentData('approved'))],
        );
        const documentId = created.rows[0].document_id;
        const correlationId = created.rows[0].correlation_id;
        assert.equal(created.rows[0].tax_authority_status, 'reserved');
        assert.equal(created.rows[0].tax_submission_status, 'queued');
        await client.query('RESET ROLE');
        let taskCount = await client.query(
          `SELECT count(*)::integer AS count FROM public.document_tasks WHERE document_id = $1`,
          [documentId],
        );
        assert.equal(taskCount.rows[0].count, 0);

        await setRuntimeContext(client, userId);
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `SELECT * FROM private.claim_api_tax_submission_batch($1::uuid, 1, 60, NULL)`,
          [leaseToken],
        );
        assert.equal(claimed.rowCount, 1);
        const submittedHash = createHash('sha256').update('submitted-result').digest('hex');
        await client.query(
          `SELECT * FROM private.process_api_tax_submission_result(
             $1::varchar, $2::varchar, $3::varchar, 'submitted',
             NULL, 'authority-request-1', NULL, NULL, clock_timestamp()
           )`,
          [correlationId, `immediate:${claimed.rows[0].submission_id}`, submittedHash],
        );
        await client.query('RESET ROLE');
        taskCount = await client.query(
          `SELECT count(*)::integer AS count FROM public.document_tasks WHERE document_id = $1`,
          [documentId],
        );
        assert.equal(taskCount.rows[0].count, 0);

        const eventId = `callback:${randomUUID()}`;
        const approvalHash = createHash('sha256').update('approved-result').digest('hex');
        await setRuntimeContext(client, userId);
        const approved = await client.query(
          `SELECT * FROM private.process_api_tax_callback(
             $1::varchar, $2::varchar, $3::varchar, 'approved',
             'CONFIRM-901', NULL, NULL, clock_timestamp()
           )`,
          [eventId, approvalHash, correlationId],
        );
        assert.equal(approved.rows[0].processed, true);
        assert.equal(approved.rows[0].idempotent_replay, false);
        const replay = await client.query(
          `SELECT * FROM private.process_api_tax_callback(
             $1::varchar, $2::varchar, $3::varchar, 'approved',
             'CONFIRM-901', NULL, NULL, clock_timestamp()
           )`,
          [eventId, approvalHash, correlationId],
        );
        assert.equal(replay.rows[0].idempotent_replay, true);
        await client.query('SAVEPOINT conflicting_callback');
        await expectDatabaseError(
          client.query(
            `SELECT * FROM private.process_api_tax_callback(
               $1::varchar, $2::varchar, $3::varchar, 'rejected',
               NULL, 'conflict', 'conflict', clock_timestamp()
             )`,
            [eventId, createHash('sha256').update('conflict').digest('hex'), correlationId],
          ),
          '40001',
          /TAX_CALLBACK_PAYLOAD_CONFLICT/,
        );
        await client.query('ROLLBACK TO SAVEPOINT conflicting_callback');
        await client.query('RESET ROLE');
        const state = await client.query(
          `SELECT document.tax_authority_status::text AS tax_status,
                  document.confirmation_number,
                  submission.status::text AS submission_status,
                  count(task.id)::integer AS task_count
           FROM public.documents AS document
           INNER JOIN private.tax_submissions AS submission ON submission.document_id = document.id
           LEFT JOIN public.document_tasks AS task ON task.document_id = document.id
           WHERE document.id = $1
           GROUP BY document.tax_authority_status, document.confirmation_number, submission.status`,
          [documentId],
        );
        assert.deepEqual(state.rows[0], {
          tax_status: 'approved',
          confirmation_number: 'CONFIRM-901',
          submission_status: 'approved',
          task_count: 1,
        });

        await setRuntimeContext(client, userId);
        const rejected = await client.query(
          `SELECT * FROM private.create_api_tax_invoice($1::uuid, $2::jsonb, clock_timestamp())`,
          [companyId, JSON.stringify(taxDocumentData('rejected'))],
        );
        await client.query(
          `SELECT * FROM private.process_api_tax_callback(
             $1::varchar, $2::varchar, $3::varchar, 'rejected',
             NULL, 'AUTHORITY_REJECTED', 'Invalid invoice', clock_timestamp()
           )`,
          [
            `callback:${randomUUID()}`,
            createHash('sha256').update('rejected-result').digest('hex'),
            rejected.rows[0].correlation_id,
          ],
        );
        await client.query('RESET ROLE');
        const rejectedState = await client.query(
          `SELECT document.tax_authority_status::text AS tax_status,
                  submission.status::text AS submission_status,
                  count(task.id)::integer AS task_count
           FROM public.documents AS document
           INNER JOIN private.tax_submissions AS submission ON submission.document_id = document.id
           LEFT JOIN public.document_tasks AS task ON task.document_id = document.id
           WHERE document.id = $1
           GROUP BY document.tax_authority_status, submission.status`,
          [rejected.rows[0].document_id],
        );
        assert.deepEqual(rejectedState.rows[0], {
          tax_status: 'rejected',
          submission_status: 'rejected',
          task_count: 0,
        });
      });
    });

    it('claims canonical PDF/email work and makes expired sends delivery-unknown', async () => {
      await withTransaction(async (client) => {
        const userId = randomUUID();
        const companyId = randomUUID();
        const membershipId = randomUUID();
        await insertWorkflowCompany(client, {
          userId,
          companyId,
          membershipId,
          publicCompanyId: publicCompanyBase + 902,
        });
        await setRuntimeContext(client, userId);
        const created = await client.query(
          `SELECT * FROM private.create_api_tax_invoice($1::uuid, $2::jsonb, clock_timestamp())`,
          [companyId, JSON.stringify(taxDocumentData('email'))],
        );
        const documentId = created.rows[0].document_id;
        const resultKey = `callback:${randomUUID()}`;
        await client.query(
          `SELECT * FROM private.process_api_tax_callback(
             $1::varchar, $2::varchar, $3::varchar, 'approved',
             'CONFIRM-902', NULL, NULL, clock_timestamp()
           )`,
          [
            resultKey,
            createHash('sha256').update('pdf-approved').digest('hex'),
            created.rows[0].correlation_id,
          ],
        );
        await client.query('RESET ROLE');
        const task = await client.query(
          `SELECT task_key FROM public.document_tasks WHERE document_id = $1`,
          [documentId],
        );
        const taskKey = task.rows[0].task_key;

        await setRuntimeContext(client, userId);
        const dispatchLease = randomUUID();
        await client.query(
          `SELECT * FROM private.claim_api_document_dispatch_batch($1::uuid, 1, 30, $2::text)`,
          [dispatchLease, taskKey],
        );
        await client.query(
          `SELECT private.complete_api_document_dispatch($1::text, $2::uuid, clock_timestamp())`,
          [taskKey, dispatchLease],
        );
        await client.query('RESET ROLE');

        const pdfLease = randomUUID();
        await client.query('SET LOCAL ROLE smart_job_pdf');
        const canonical = await client.query(
          `SELECT * FROM private.claim_pdf_document_task($1::text, $2::uuid, 300)`,
          [taskKey, pdfLease],
        );
        assert.equal(canonical.rows[0].internal_company_id, companyId);
        assert.equal(canonical.rows[0].internal_document_id, documentId);
        assert.equal(canonical.rows[0].confirmation_number, 'CONFIRM-902');
        const storagePath = `${companyId}/documents/${documentId}.pdf`;
        const completed = await client.query(
          `SELECT * FROM private.complete_pdf_document_task(
             $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text, 1024, clock_timestamp()
           )`,
          [taskKey, pdfLease, companyId, documentId, storagePath],
        );
        const deliveryId = completed.rows[0].delivery_id;
        assert.ok(deliveryId);
        await client.query('RESET ROLE');

        await setRuntimeContext(client, userId);
        const emailDispatchLease = randomUUID();
        await client.query(
          `SELECT * FROM private.claim_api_email_dispatch_batch($1::uuid, 1, 30, $2::uuid)`,
          [emailDispatchLease, deliveryId],
        );
        await client.query('RESET ROLE');

        // A push may reach the email worker before the publisher records its
        // successful Pub/Sub call. If that send then fails before SES, the
        // later publisher completion must not erase the queued retry.
        const emailLease = randomUUID();
        await client.query('SET LOCAL ROLE smart_job_email');
        const email = await client.query(
          `SELECT * FROM private.claim_email_delivery($1::uuid, $2::uuid, 10)`,
          [deliveryId, emailLease],
        );
        assert.equal(email.rows[0].internal_company_id, companyId);
        assert.equal(email.rows[0].storage_path, storagePath);
        const deferred = await client.query(
          `SELECT private.resolve_email_delivery_failure(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             'queued', 'Storage signing unavailable', 30
           ) AS resolved`,
          [deliveryId, emailLease, companyId, documentId],
        );
        assert.equal(deferred.rows[0].resolved, true);
        await client.query('RESET ROLE');

        await setRuntimeContext(client, userId);
        const completedRace = await client.query(
          `SELECT private.complete_api_email_dispatch(
             $1::uuid, $2::uuid, clock_timestamp()
           ) AS completed`,
          [deliveryId, emailDispatchLease],
        );
        assert.equal(completedRace.rows[0].completed, true);
        await client.query('RESET ROLE');
        const retryState = await client.query(
          `SELECT status::text AS status, dispatched_at, dispatch_lease_token
           FROM private.document_email_deliveries WHERE id = $1`,
          [deliveryId],
        );
        assert.deepEqual(retryState.rows[0], {
          status: 'queued',
          dispatched_at: null,
          dispatch_lease_token: null,
        });

        await client.query(
          `UPDATE private.document_email_deliveries
           SET next_dispatch_at = clock_timestamp()
           WHERE id = $1`,
          [deliveryId],
        );
        await setRuntimeContext(client, userId);
        const secondDispatchLease = randomUUID();
        const reclaimedDispatch = await client.query(
          `SELECT * FROM private.claim_api_email_dispatch_batch($1::uuid, 1, 30, $2::uuid)`,
          [secondDispatchLease, deliveryId],
        );
        assert.equal(reclaimedDispatch.rowCount, 1);
        await client.query(
          `SELECT private.complete_api_email_dispatch($1::uuid, $2::uuid, clock_timestamp())`,
          [deliveryId, secondDispatchLease],
        );
        await client.query('RESET ROLE');

        const ambiguousLease = randomUUID();
        await client.query('SET LOCAL ROLE smart_job_email');
        const ambiguousSend = await client.query(
          `SELECT * FROM private.claim_email_delivery($1::uuid, $2::uuid, 10)`,
          [deliveryId, ambiguousLease],
        );
        assert.equal(ambiguousSend.rowCount, 1);
        await client.query('RESET ROLE');
        await client.query(
          `UPDATE private.document_email_deliveries
           SET send_lease_until = clock_timestamp() - interval '1 second'
           WHERE id = $1`,
          [deliveryId],
        );
        await client.query('SET LOCAL ROLE smart_job_email');
        const expired = await client.query(
          `SELECT * FROM private.claim_email_delivery($1::uuid, $2::uuid, 10)`,
          [deliveryId, randomUUID()],
        );
        assert.equal(expired.rowCount, 0);
        await client.query('RESET ROLE');
        const finalState = await client.query(
          `SELECT status::text AS status FROM private.document_email_deliveries WHERE id = $1`,
          [deliveryId],
        );
        assert.equal(finalState.rows[0].status, 'delivery_unknown');
      });
    });
  });
}
