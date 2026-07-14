import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('solo finished jobs use the encrypted SQLite outbox before synchronization', () => {
  const fillJob = readProjectFile('modules', 'jobs', 'screens', 'FillJob.tsx');

  const stageIndex = fillJob.indexOf('const attachments = await stageFinishedJobAttachments({');
  const enqueueIndex = fillJob.indexOf('const operationId = await enqueueOutboxOperation({');
  const synchronizeIndex = fillJob.indexOf('await synchronizeOperation(operationId);');
  assert.notEqual(stageIndex, -1);
  assert.notEqual(enqueueIndex, -1);
  assert.notEqual(synchronizeIndex, -1);
  assert.ok(stageIndex < enqueueIndex, 'attachments must be encrypted before the operation is committed');
  assert.ok(enqueueIndex < synchronizeIndex, 'the durable operation must exist before foreground synchronization');
  assert.match(fillJob, /kind: 'job\.create_finished'/);
  assert.match(fillJob, /companyId: workspace\.companyId/);
  assert.match(fillJob, /userId: sessionUser\.id/);
  assert.doesNotMatch(fillJob, /getPendingUserJobsStorageKey/);
  assert.doesNotMatch(fillJob, /createJobV1/);
});

test('assigned jobs complete through the same encrypted outbox with entity versions', () => {
  const fillJob = readProjectFile('modules', 'jobs', 'screens', 'FillJob.tsx');

  const stageIndex = fillJob.lastIndexOf('const attachments = await stageFinishedJobAttachments({');
  const enqueueIndex = fillJob.indexOf("kind: 'job.complete_assigned'");
  const synchronizeIndex = fillJob.lastIndexOf('await synchronizeOperation(operationId);');
  assert.notEqual(stageIndex, -1);
  assert.notEqual(enqueueIndex, -1);
  assert.notEqual(synchronizeIndex, -1);
  assert.ok(stageIndex < enqueueIndex, 'attachments must be encrypted before completion is enqueued');
  assert.ok(enqueueIndex < synchronizeIndex, 'completion must be durable before synchronization');
  assert.match(fillJob, /entityVersion: editingJob\.entityVersion/);
  assert.match(fillJob, /tenantQueryKey\(sessionUser\.id, workspace\.companyId, 'jobs'\)/);
  assert.doesNotMatch(fillJob, /pendingWorkerJobs|enqueuePendingWorkerJob/);
  assert.doesNotMatch(fillJob, /updateJobV1|uploadJobFilesForStorage|httpsCallable/);
});

test('online field-job submissions report the operation outcome instead of transport availability', () => {
  const fillJob = readProjectFile('modules', 'jobs', 'screens', 'FillJob.tsx');
  const reconciledCheck = fillJob.indexOf("result.outcome === 'reconciled'");
  const successAlert = fillJob.indexOf("alert.success('Success', t.success)");

  assert.ok(reconciledCheck >= 0 && reconciledCheck < successAlert);
  assert.match(fillJob, /result\.outcome === 'retry'/);
  assert.match(fillJob, /result\.outcome === 'terminal'/);
  assert.match(fillJob, /result\.outcome === 'conflict'/);
  assert.match(fillJob, /outcome: 'queued'/);
  assert.doesNotMatch(fillJob, /if \(isOnline\) \{\s*alert\.success/);
});

test('finished-job staging keeps plaintext in bounded memory and cleans partial encrypted work', () => {
  const staging = readProjectFile(
    'modules',
    'jobs',
    'lib',
    'finished-job-outbox-attachments.ts',
  );
  const encryptedStorage = readProjectFile('lib', 'outbox', 'attachments.ts');

  assert.match(staging, /sourceBytes: plaintextBytes/);
  assert.match(staging, /plaintextBytes\.fill\(0\)/);
  assert.match(staging, /MAX_BASE64_CHARACTERS/);
  assert.doesNotMatch(staging, /Paths\.cache|temporaryFile|\.write\(plaintextBytes/);
  assert.match(staging, /stageEncryptedAttachment/);
  assert.match(staging, /deleteStagedAttachmentDirectory/);
  assert.match(staging, /MAX_JOB_ATTACHMENT_TOTAL_BYTES/);
  assert.match(encryptedStorage, /requireOwnedAttachmentDirectoryUri/);
  assert.match(encryptedStorage, /requireAttachmentDirectory/);
  assert.match(encryptedStorage, /requireJobAttachmentMimeType\(header, mimeType\)/);
  const sizeGuard = encryptedStorage.indexOf('if (sourceSize > MAX_JOB_ATTACHMENT_BYTES)');
  const keyAccess = encryptedStorage.indexOf('const key = await getOrCreateFileKey');
  assert.ok(sizeGuard >= 0 && sizeGuard < keyAccess, '10 MiB must be rejected before key or path staging');
});
