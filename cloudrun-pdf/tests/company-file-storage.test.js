const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

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

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = Date.UTC(2026, 6, 28, 12);

function createFixture(options = {}) {
  const calls = { save: [], remove: [], sign: [], info: [], download: [] };
  const existingBytes = options.existingBytes || Buffer.from('%PDF fixture');
  const objectStore = {
    async checkReadiness() {},
    async saveCreateOnly(path, bytes, metadata) {
      calls.save.push({ path, bytes: Buffer.from(bytes), metadata });
      return options.saveResult || 'created';
    },
    async getMetadata(path) {
      calls.info.push(path);
      return options.objectMissing
        ? null
        : {
            sizeBytes: options.metadataSize ?? existingBytes.length,
            contentType: options.contentType || 'application/pdf',
          };
    },
    async download(path) {
      calls.download.push(path);
      return Buffer.from(existingBytes);
    },
    async createSignedDownloadUrl(path, expiresAt) {
      calls.sign.push({ path, expiresAt });
      return `https://storage.googleapis.com/${COMPANY_FILES_BUCKET}/${path}?X-Goog-Signature=test`;
    },
    async remove(path) {
      calls.remove.push(path);
    },
  };
  return {
    calls,
    storage: createCompanyFileStorage({
      bucketId: COMPANY_FILES_BUCKET,
      objectStore,
      now: () => NOW,
    }),
  };
}

test('GCS configuration is provider-neutral and local overrides are marker-gated', () => {
  const production = resolveCompanyFileStorageConfig({
    GCS_PROJECT_ID: 'smart-job-prod',
    COMPANY_FILES_BUCKET,
  });
  assert.deepEqual(production, {
    projectId: 'smart-job-prod',
    bucketId: COMPANY_FILES_BUCKET,
  });
  assert.throws(() => resolveCompanyFileStorageConfig({
    COMPANY_FILES_BUCKET: 'INVALID_BUCKET',
  }), /COMPANY_FILES_BUCKET/);

  const local = resolveCompanyFileStorageConfig({
    SMART_JOB_DEPLOYMENT_ENV: 'local',
    SMART_JOB_LOCAL_PLATFORM: 'true',
    LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
    GCS_PROJECT_ID: 'smart-job-local',
    GCS_API_ENDPOINT: 'http://gcs-emulator:4443',
    COMPANY_FILES_PUBLIC_BASE_URL: 'http://127.0.0.1:58080',
  }, () => 'smart-job-erp-local-platform-v1');
  assert.equal(local.apiEndpoint, 'http://gcs-emulator:4443');
  assert.equal(local.publicBaseUrl.href, 'http://127.0.0.1:58080/');
  assert.throws(() => resolveCompanyFileStorageConfig({
    SMART_JOB_DEPLOYMENT_ENV: 'local',
    SMART_JOB_LOCAL_PLATFORM: 'true',
    LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
    GCS_API_ENDPOINT: 'http://gcs-emulator:4443',
    COMPANY_FILES_PUBLIC_BASE_URL: 'http://127.0.0.1:58080',
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
});

test('new PDF save is create-only and records its SHA-256 metadata', async () => {
  const fixture = createFixture();
  const bytes = Buffer.from('%PDF new object');
  const path = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  const stored = await fixture.storage.storePdfCreateOnly(path, bytes, { taskId: 'task-1' });

  assert.equal(stored.created, true);
  assert.equal(stored.objectPath, path);
  assert.equal(fixture.calls.save.length, 1);
  assert.equal(fixture.calls.save[0].metadata.taskId, 'task-1');
  assert.equal(
    fixture.calls.save[0].metadata.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
});

test('duplicate path reuses only byte-identical PDF content without overwriting', async () => {
  const bytes = Buffer.from('%PDF retry bytes');
  const fixture = createFixture({ existingBytes: bytes, saveResult: 'exists' });
  const path = buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID);
  const stored = await fixture.storage.storePdfCreateOnly(path, bytes);

  assert.equal(stored.created, false);
  assert.deepEqual(fixture.calls.info, [path]);
  assert.deepEqual(fixture.calls.download, [path]);
  assert.equal(fixture.calls.save.length, 1);
});

test('duplicate path with different bytes is a permanent conflict', async () => {
  const fixture = createFixture({
    existingBytes: Buffer.from('%PDF existing bytes'),
    saveResult: 'exists',
  });
  await assert.rejects(
    fixture.storage.storePdfCreateOnly(
      buildGeneratedDocumentObjectPath(COMPANY_ID, DOCUMENT_ID),
      Buffer.from('%PDF different bytes'),
    ),
    (error) => error?.code === 'storage_object_conflict' && error?.retryable === false,
  );
});

test('failure before SQL finalization retains create-only bytes for a safe retry', async () => {
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
});

test('signed download URLs and optional branding reads use the exact GCS object', async () => {
  const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const fixture = createFixture({
    existingBytes: logo,
    contentType: 'image/png',
  });
  const path = buildCompanyLogoObjectPath(COMPANY_ID);
  assert.match(
    await fixture.storage.createSignedDownloadUrl(path, 900),
    /X-Goog-Signature=test$/,
  );
  assert.deepEqual(fixture.calls.sign, [{ path, expiresAt: NOW + 900_000 }]);
  assert.deepEqual(
    await fixture.storage.downloadOptionalImage(path, 1024),
    { bytes: logo, contentType: 'image/png' },
  );
});

test('missing optional branding returns null and cleanup stays idempotent', async () => {
  const missing = createFixture({ objectMissing: true });
  const path = buildCompanyLogoObjectPath(COMPANY_ID);
  assert.equal(await missing.storage.downloadOptionalImage(path, 1024), null);
  await missing.storage.removeObject(path);
  assert.deepEqual(missing.calls.remove, [path]);
});
