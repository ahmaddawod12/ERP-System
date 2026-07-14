import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  InvitationCreateRequestSchema,
  WorkerSummarySchema,
  WorkerUpdateRequestSchema,
} from '@smart-job/api-contracts';

test('worker mutation contracts keep invitation and entity-version boundaries explicit', () => {
  const worker = WorkerSummarySchema.parse({
    memberNo: 7,
    role: 'worker',
    status: 'active',
    displayName: 'Field Worker',
    email: 'worker@example.com',
    phoneNumber: '0501234567',
    entityVersion: 'worker-version-1',
    joinedAt: '2026-07-13T10:00:00.000Z',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
  });
  assert.equal(worker.memberNo, 7);

  const invitation = InvitationCreateRequestSchema.parse({
    targetRole: 'worker',
    targetEmail: 'WORKER@EXAMPLE.COM',
  });
  assert.equal(invitation.targetEmail, 'worker@example.com');
  assert.equal(invitation.expiresInDays, 30);

  const update = WorkerUpdateRequestSchema.parse({
    entityVersion: worker.entityVersion,
    role: 'user',
    status: 'disabled',
  });
  assert.equal(update.entityVersion, worker.entityVersion);
});

test('team screen uses bounded tenant API pages and no Firebase management callable', async () => {
  const [screen, api, hook] = await Promise.all([
    readFile(new URL('../modules/workers/screens/WorkersUsers.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/workers/lib/workers-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/workers/lib/use-workers-infinite.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(api, /requestApi/);
  assert.match(api, /pageSize: '50'/);
  assert.match(api, /WorkerListPageSchema/);
  assert.match(api, /method: 'PATCH'/);
  assert.match(api, /method: 'DELETE'/);
  assert.match(api, /Idempotency|idempotencyKey/);
  assert.doesNotMatch(api, /firebase|httpsCallable|MMKV/i);

  assert.match(hook, /useInfiniteQuery/);
  assert.match(hook, /tenantQueryKey\(uid, companyId, 'workers'\)/);
  assert.match(hook, /previousKey\[1\] === uid/);
  assert.match(hook, /previousKey\[2\] === companyId/);

  assert.match(screen, /useWorkersInfinite/);
  assert.match(screen, /createWorkerInvitation/);
  assert.match(screen, /updateWorkerMembership/);
  assert.match(screen, /disableWorkerMembership/);
  assert.match(screen, /entityVersion: editDraft\.worker\.entityVersion/);
  assert.match(screen, /randomUUID\(\)/);
  assert.match(screen, /fetchNextPage/);
  assert.match(screen, /workersQuery\.isError && workers\.length > 0/);
  assert.doesNotMatch(
    screen,
    /httpsCallable|manageWorker|auth\.currentUser|useCache|cachedWorkers|console\./,
  );
});
