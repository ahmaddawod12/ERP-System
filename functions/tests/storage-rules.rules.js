const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  deleteObject,
  getBytes,
  ref,
  uploadString,
} = require('firebase/storage');

function resolveRepoRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'storage.rules'))) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve repo root from ${__dirname}`);
}

const projectId = 'demo-smart-job';
const storageRules = fs.readFileSync(
  path.resolve(resolveRepoRoot(), 'storage.rules'),
  'utf8',
);

function resolveEmulatorHost(envName, defaultHost) {
  const rawHost = process.env[envName] || defaultHost;
  const [host, rawPort] = rawHost.split(':');
  return {
    host,
    port: Number(rawPort),
  };
}

let testEnv;

test.before(async () => {
  const firestore = resolveEmulatorHost('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  const storage = resolveEmulatorHost('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore,
    storage: {
      host: storage.host,
      port: storage.port,
      rules: storageRules,
    },
  });
});

test.after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test('users can upload their own job images but not read other users files', async () => {
  const ownerStorage = testEnv.authenticatedContext('user-1').storage();
  const otherStorage = testEnv.authenticatedContext('user-2').storage();
  const filePath = 'user-1/jobs/job-1/photo.jpg';

  await assertSucceeds(
    uploadString(ref(ownerStorage, filePath), 'image-bytes', 'raw', {
      contentType: 'image/jpeg',
    }),
  );
  await assertSucceeds(getBytes(ref(ownerStorage, filePath)));
  await assertFails(getBytes(ref(otherStorage, filePath)));
});

test('company document storage is backend-only even for authenticated users', async () => {
  const storage = testEnv.authenticatedContext('manager-1').storage();
  const documentPath = 'companies/1001/documents/INV1-1001.pdf';

  await assertFails(getBytes(ref(storage, documentPath)));
  await assertFails(
    uploadString(ref(storage, documentPath), 'pdf-bytes', 'raw', {
      contentType: 'application/pdf',
    }),
  );
  await assertFails(deleteObject(ref(storage, documentPath)));
  assert.ok(testEnv);
});
