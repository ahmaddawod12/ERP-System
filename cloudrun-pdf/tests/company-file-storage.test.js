const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');

const {
  COMPANY_FILES_BUCKET,
  createCompanyFileStorage,
  resolveCompanyFileStorageConfig,
} = require('../company-file-storage');
const { persistPdfBeforeFinalize } = require('../pdf-storage-workflow');
const {
  buildCompanyLogoObjectPath,
  buildGeneratedDocumentObjectPath,
  buildPreviewObjectPath,
} = require('../storage-paths');

const BASE_URL = new URL('https://fixture.supabase.co/');
const SECRET_KEY = 'sb_secret_pdf_storage_fixture';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function signedUrl(path) {
  return `${BASE_URL.href}storage/v1/object/sign/${COMPANY_FILES_BUCKET}/${path}?token=test-token`;
}

function createFixture(options = {}) {
  const calls = { upload: [], remove: [], sign: [], info: [], download: [] };
  const bytes = options.existingBytes || Buffer.from('%PDF fixture');
  const bucket = {
    async upload(path, body, uploadOptions) {
      calls.upload.push({ path, body: Buffer.from(body), options: uploadOptions });
      return options.uploadResult || { data: { path }, error: null };
    },
    async info(path) {
      calls.info.push(path);
      return options.infoResult || {
        data: { size: bytes.length, contentType: 'application/pdf' },
        error: null,
      };
    },
    async download(path) {
      calls.download.push(path);
      return options.downloadResult || { data: new Blob([bytes]), error: null };
    },
    async createSignedUrl(path, expiry) {
      calls.sign.push({ path, expiry });
      return options.signedResult || { data: { signedUrl: signedUrl(path) }, error: null };
    },
    async remove(paths) {
      calls.remove.push([...paths]);
      return options.removeResult || { data: [], error: null };
    },
  };
  const client = { storage: { from: (bucketId) => {
    assert.equal(bucketId, COMPANY_FILES_BUCKET);
    return bucket;
  } } };
  return {
    calls,
    storage: createCompanyFileStorage({
      baseUrl: BASE_URL,
      secretKey: SECRET_KEY,
      client,
    }),
  };
}

test('storage configuration requires a server-only secret key and canonical private bucket', () => {
  const config = resolveCompanyFileStorageConfig({
    SUPABASE_URL: BASE_URL.href,
    SUPABASE_SECRET_KEY: SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: COMPANY_FILES_BUCKET,
  });
  assert.equal(config.bucketId, COMPANY_FILES_BUCKET);
  assert.equal(config.secretKey, SECRET_KEY);

  assert.throws(() => resolveCompanyFileStorageConfig({
    SUPABASE_URL: BASE_URL.href,
    SUPABASE_SECRET_KEY: 'legacy-service-role-jwt',
  }), /SUPABASE_SECRET_KEY/);
  assert.throws(() => resolveCompanyFileStorageConfig({
    SUPABASE_URL: BASE_URL.href,
    SUPABASE_SECRET_KEY: SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: 'some-other-bucket',
  }), /smart-job-company-files/);
});

test('marker-gated local storage uses internal transport and public loopback signed URLs', async () => {
  const internalBaseUrl = new URL('http://supabase_kong_smart-job-erp-local:8000/');
  const publicBaseUrl = new URL('http://127.0.0.1:55321/');
  const config = resolveCompanyFileStorageConfig({
    SMART_JOB_DEPLOYMENT_ENV: 'local',
    SMART_JOB_LOCAL_PLATFORM: 'true',
    LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
    SUPABASE_URL: internalBaseUrl.href,
    SUPABASE_PUBLIC_URL: publicBaseUrl.href,
    SUPABASE_SECRET_KEY: SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: COMPANY_FILES_BUCKET,
  }, () => 'smart-job-erp-local-platform-v1');
  assert.equal(config.baseUrl.href, internalBaseUrl.href);
  assert.equal(config.publicBaseUrl.href, publicBaseUrl.href);

  const objectPath = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  const internalSignedUrl = `${internalBaseUrl.href}storage/v1/object/sign/${COMPANY_FILES_BUCKET}/${objectPath}?token=local`;
  const storage = createCompanyFileStorage({
    ...config,
    client: {
      storage: {
        from() {
          return {
            async createSignedUrl() {
              return { data: { signedUrl: internalSignedUrl }, error: null };
            },
          };
        },
      },
    },
  });
  assert.equal(
    await storage.createSignedDownloadUrl(objectPath, 900),
    internalSignedUrl.replace(internalBaseUrl.origin, publicBaseUrl.origin),
  );
  assert.throws(() => resolveCompanyFileStorageConfig({
    SMART_JOB_DEPLOYMENT_ENV: 'local',
    SMART_JOB_LOCAL_PLATFORM: 'true',
    LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
    SUPABASE_URL: internalBaseUrl.href,
    SUPABASE_PUBLIC_URL: publicBaseUrl.href,
    SUPABASE_SECRET_KEY: SECRET_KEY,
  }, () => 'wrong'), /mounted local-platform marker/);
});

test('object paths are tenant-UUID scoped and preview task IDs are hashed', () => {
  assert.equal(
    buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID),
    `${COMPANY_ID}/documents/${DOCUMENT_ID}.pdf`,
  );
  assert.equal(buildCompanyLogoObjectPath(COMPANY_ID), `${COMPANY_ID}/branding/logo.png`);

  const taskId = 'preview:tenant:user:unsafe/value';
  const taskHash = createHash('sha256').update(taskId).digest('hex');
  assert.equal(
    buildPreviewObjectPath(COMPANY_ID, USER_ID, taskId),
    `${COMPANY_ID}/previews/${USER_ID}/${taskHash}.pdf`,
  );
  assert.doesNotMatch(buildPreviewObjectPath(COMPANY_ID, USER_ID, taskId), /unsafe|preview:/);
});

test('new PDF upload is create-only and never enables upsert', async () => {
  const fixture = createFixture();
  const bytes = Buffer.from('%PDF new object');
  const path = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  const stored = await fixture.storage.storePdfCreateOnly(path, bytes, { taskId: 'task-1' });

  assert.equal(stored.created, true);
  assert.equal(stored.objectPath, path);
  assert.equal(fixture.calls.upload.length, 1);
  assert.equal(fixture.calls.upload[0].options.upsert, false);
  assert.equal(fixture.calls.upload[0].options.contentType, 'application/pdf');
  assert.equal(fixture.calls.upload[0].options.cacheControl, '3600');
  assert.equal(
    fixture.calls.upload[0].options.metadata.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
});

test('duplicate path reuses only byte-identical PDF content without overwriting', async () => {
  const bytes = Buffer.from('%PDF retry bytes');
  const fixture = createFixture({
    existingBytes: bytes,
    uploadResult: {
      data: null,
      error: { statusCode: 409, code: 'already_exists', message: 'Asset Already Exists' },
    },
  });
  const path = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  const stored = await fixture.storage.storePdfCreateOnly(path, bytes);

  assert.equal(stored.created, false);
  assert.deepEqual(fixture.calls.info, [path]);
  assert.deepEqual(fixture.calls.download, [path]);
  assert.equal(fixture.calls.upload[0].options.upsert, false);
});

test('duplicate path with different bytes is a permanent conflict', async () => {
  const fixture = createFixture({
    existingBytes: Buffer.from('%PDF existing bytes'),
    uploadResult: {
      data: null,
      error: { statusCode: 409, code: 'already_exists', message: 'Asset Already Exists' },
    },
  });
  await assert.rejects(
    fixture.storage.storePdfCreateOnly(
      buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID),
      Buffer.from('%PDF different bytes'),
    ),
    (error) => error?.code === 'storage_object_conflict' && error?.retryable === false,
  );
});

test('failure before SQL finalization retains create-only bytes for safe retry', async () => {
  const fixture = createFixture();
  const path = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  await assert.rejects(
    persistPdfBeforeFinalize({
      storage: fixture.storage,
      objectPath: path,
      bytes: Buffer.from('%PDF cleanup fixture'),
      signedUrlExpiries: { task: 900 },
      finalize: async () => { throw new Error('SQL finalization unavailable'); },
    }),
    /SQL finalization unavailable/,
  );
  assert.deepEqual(fixture.calls.remove, []);

  const reused = createFixture({
    existingBytes: Buffer.from('%PDF cleanup fixture'),
    uploadResult: {
      data: null,
      error: { statusCode: 409, code: 'already_exists', message: 'Asset Already Exists' },
    },
  });
  await assert.rejects(
    persistPdfBeforeFinalize({
      storage: reused.storage,
      objectPath: path,
      bytes: Buffer.from('%PDF cleanup fixture'),
      signedUrlExpiries: { task: 900 },
      finalize: async () => { throw new Error('SQL finalization unavailable'); },
    }),
    /SQL finalization unavailable/,
  );
  assert.deepEqual(reused.calls.remove, []);
});

test('local Supabase Storage preserves create-only bytes and serves a signed private URL', {
  skip: !process.env.SMART_JOB_STORAGE_INTEGRATION
    || !process.env.SUPABASE_URL
    || !process.env.SUPABASE_SECRET_KEY,
  timeout: 30_000,
}, async () => {
  const storage = createCompanyFileStorage({
    baseUrl: new URL(process.env.SUPABASE_URL),
    secretKey: process.env.SUPABASE_SECRET_KEY,
  });
  const path = buildGeneratedDocumentObjectPath(randomUUID(), randomUUID());
  const bytes = Buffer.from('%PDF-1.7\nlocal Supabase integration fixture\n%%EOF');
  try {
    const created = await storage.storePdfCreateOnly(path, bytes, { fixture: 'true' });
    assert.equal(created.created, true);
    const replay = await storage.storePdfCreateOnly(path, bytes, { fixture: 'true' });
    assert.equal(replay.created, false);

    await assert.rejects(
      storage.storePdfCreateOnly(path, Buffer.from('%PDF different fixture')),
      (error) => error?.code === 'storage_object_conflict',
    );

    const url = await storage.createSignedDownloadUrl(path, 60);
    const response = await fetch(url, { redirect: 'error' });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    await storage.removeObject(path);
  }
});
