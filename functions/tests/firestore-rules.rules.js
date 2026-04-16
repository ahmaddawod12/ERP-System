const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');

const projectId = 'demo-smart-job';
const firestoreRules = fs.readFileSync(
  path.resolve(__dirname, '../../firestore.rules'),
  'utf8',
);

function resolveFirestoreHost() {
  const rawHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, rawPort] = rawHost.split(':');
  return {
    host,
    port: Number(rawPort || 8080),
  };
}

let testEnv;

test.before(async () => {
  const { host, port } = resolveFirestoreHost();
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: firestoreRules,
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('upgrade_requests').doc('req-1').set({
      uid: 'user-1',
      status: 'pending',
    });
    await db.collection('users').doc('manager-1').collection('data').doc('profile').set({
      companyId: '1001',
      accountType: 'business',
      role: 'manager',
      mid: '3',
    });
    await db.collection('companies').doc('1001').set({ name: 'Company 1001' });
    await db.collection('companies').doc('1001').collection('managers').doc('3').set({
      uid: 'manager-1',
      role: 'manager',
    });
  });
});

test.after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test('clients cannot write to locked company collections from Firestore clients', async () => {
  const db = testEnv.authenticatedContext('user-1').firestore();

  await assertFails(
    db.collection('companies').doc('1001').collection('clients').doc('1').set({
      name: 'Acme Client',
    }),
  );
  await assertFails(
    db.collection('companies').doc('1001').collection('jobs').doc('1').set({
      title: 'Blocked job write',
      status: 'pending',
    }),
  );
  await assertFails(
    db.collection('companies').doc('1001').collection('documents').doc('PP42-1001').set({
      storagePath: 'companies/1001/documents/PP42-1001.pdf',
    }),
  );
  await assertFails(
    db.collection('companies').doc('1001').collection('workers').doc('7').set({
      uid: 'user-7',
      role: 'worker',
    }),
  );
});

test('company manager membership docs are readable but mutation-locked', async () => {
  const db = testEnv.authenticatedContext('manager-1').firestore();

  await assertSucceeds(
    db.collection('companies').doc('1001').collection('managers').doc('3').get(),
  );
  await assertFails(
    db.collection('companies').doc('1001').collection('managers').doc('3').update({
      role: 'dev',
    }),
  );
});

test('upgrade requests cannot be moderated directly from Firestore clients', async () => {
  const db = testEnv.authenticatedContext('dev-user', { admin: true }).firestore();

  await assertFails(
    db.collection('upgrade_requests').doc('req-1').update({
      status: 'approved',
    }),
  );
});

test('sanity check: rules test environment initialized', async () => {
  assert.ok(testEnv);
});
