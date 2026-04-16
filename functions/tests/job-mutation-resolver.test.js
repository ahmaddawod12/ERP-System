const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JobMutationError,
  extractStoragePathFromUrl,
  resolveJobMutationPayload,
} = require('../src/job-mutation-resolver');

test('manager create resolves worker, manager, and client identities server-side', async () => {
  const payload = await resolveJobMutationPayload({
    input: {
      title: 'Install AC',
      description: 'Roof unit replacement',
      wid: ' 8 ',
      cid: ' 15 ',
    },
    resolvedRole: 'manager',
    callerProfile: {
      mid: 3,
      name: 'Manager Name',
      email: 'manager@example.com',
    },
    jobType: 'pending',
    isCreate: true,
    maxArrayLength: 5,
    loadWorkerByWid: async (wid) => ({ wid, name: 'Worker Name' }),
    loadClientById: async (clientId) => ({
      id: clientId,
      name: 'Acme Client',
      phone: '050-1234567',
    }),
  });

  assert.equal(payload.wid, '8');
  assert.equal(payload.wname, 'Worker Name');
  assert.equal(payload.mid, '3');
  assert.equal(payload.mname, 'Manager Name');
  assert.equal(payload.cid, '15');
  assert.equal(payload.cname, 'Acme Client');
  assert.equal(payload.cphone, '050-1234567');
});

test('pending manager create without assignee keeps assignment empty but preserves manager metadata', async () => {
  const payload = await resolveJobMutationPayload({
    input: {
      title: 'Unassigned visit',
      description: 'Pending dispatch',
      cname: 'Walk-in Client',
      cphone: '050-1111111',
    },
    resolvedRole: 'manager',
    callerProfile: {
      mid: 12,
      email: 'dispatcher@example.com',
    },
    jobType: 'pending',
    isCreate: true,
    maxArrayLength: 5,
    loadWorkerByWid: async () => null,
    loadClientById: async () => null,
  });

  assert.equal(payload.wid, null);
  assert.equal(payload.wname, null);
  assert.equal(payload.mid, '12');
  assert.equal(payload.mname, 'dispatcher@example.com');
});

test('solo finished jobs derive worker identity from caller profile', async () => {
  const payload = await resolveJobMutationPayload({
    input: {
      title: 'Finished visit',
      description: 'Resolved on site',
      cname: 'Solo Client',
      finishedAt: '2026-04-04T10:00:00.000Z',
    },
    resolvedRole: 'user',
    callerProfile: {
      wid: 21,
      name: 'Solo Owner',
      email: 'solo@example.com',
    },
    jobType: 'finished',
    isCreate: true,
    maxArrayLength: 5,
    loadWorkerByWid: async () => null,
    loadClientById: async () => null,
  });

  assert.equal(payload.wid, '21');
  assert.equal(payload.wname, 'Solo Owner');
  assert.equal(payload.cname, 'Solo Client');
  assert.equal(payload.finishedAt, '2026-04-04T10:00:00.000Z');
});

test('workers cannot change assignment or client identity fields', async () => {
  await assert.rejects(
    () =>
      resolveJobMutationPayload({
        input: {
          wid: '9',
          cid: '4',
        },
        existingJob: {
          wid: '2',
          cid: '3',
        },
        resolvedRole: 'worker',
        callerProfile: {
          wid: 2,
          name: 'Worker',
        },
        jobType: 'pending',
        isCreate: false,
        maxArrayLength: 5,
        loadWorkerByWid: async () => null,
        loadClientById: async () => null,
      }),
    (error) => {
      assert.equal(error instanceof JobMutationError, true);
      assert.equal(error.code, 'permission-denied');
      return true;
    },
  );
});

test('missing client ids are rejected instead of trusting caller denormalized data', async () => {
  await assert.rejects(
    () =>
      resolveJobMutationPayload({
        input: {
          cid: '404',
        },
        resolvedRole: 'manager',
        callerProfile: {
          mid: 1,
          name: 'Manager',
        },
        jobType: 'pending',
        isCreate: false,
        maxArrayLength: 5,
        loadWorkerByWid: async () => null,
        loadClientById: async () => null,
      }),
    (error) => {
      assert.equal(error instanceof JobMutationError, true);
      assert.equal(error.code, 'not-found');
      return true;
    },
  );
});

test('job attachment URLs are canonicalized into storagePath refs', async () => {
  const payload = await resolveJobMutationPayload({
    input: {
      title: 'Finished visit',
      cname: 'Acme',
      photos: [
        'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/user-1%2Fjobs%2Fjob-7%2Fphoto_1.jpg?alt=media&token=secret',
      ],
      signature: {
        storagePath: 'user-1/jobs/job-7/signature.png',
        downloadURL: 'https://should-not-persist.example',
      },
    },
    resolvedRole: 'user',
    callerProfile: {
      wid: 7,
      name: 'Solo Owner',
      email: 'solo@example.com',
    },
    jobType: 'finished',
    isCreate: true,
    maxArrayLength: 5,
    loadWorkerByWid: async () => null,
    loadClientById: async () => null,
  });

  assert.deepEqual(payload.photos, [{ storagePath: 'user-1/jobs/job-7/photo_1.jpg' }]);
  assert.deepEqual(payload.signature, { storagePath: 'user-1/jobs/job-7/signature.png' });
});

test('attachment helper extracts Firebase storage paths from durable urls', () => {
  assert.equal(
    extractStoragePathFromUrl(
      'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/user-2%2Fjobs%2Fjob-9%2Fsignature.png?alt=media&token=secret',
    ),
    'user-2/jobs/job-9/signature.png',
  );
});
