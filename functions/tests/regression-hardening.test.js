const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(...segments) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...segments), 'utf8');
}

function assertOrder(source, firstNeedle, secondNeedle, message) {
  const first = source.indexOf(firstNeedle);
  const second = source.indexOf(secondNeedle);
  assert.notEqual(first, -1, `Missing first marker: ${firstNeedle}`);
  assert.notEqual(second, -1, `Missing second marker: ${secondNeedle}`);
  assert.ok(first < second, message);
}

test('critical Firestore transactions read all docs before writing', () => {
  const profile = readRepoFile('functions', 'src', 'profile.js');
  assertOrder(
    profile,
    'const workerSnap = workerRef ? await tx.get(workerRef) : null;',
    'tx.update(profileRef, updates);',
    'updateProfileV1 must read membership docs before updating profile',
  );

  const inventory = readRepoFile('functions', 'src', 'inventory.js');
  assertOrder(
    inventory,
    'const userSnap = await tx.get(userInvRef);',
    'tx.update(invRef, { parts: updatedCompanyParts, lastUpdated: now });',
    'pickParts must read user inventory before updating company inventory',
  );

  const jobs = readRepoFile('functions', 'src', 'jobs.js');
  assertOrder(
    jobs,
    'workerInvSnap = await tx.get(workerInvRef);',
    'tx.update(jobRef, {',
    'acceptJobV1 must read worker inventory before updating the job',
  );
});

test('job notification triggers claim dedup records before sending pushes', () => {
  const jobs = readRepoFile('functions', 'src', 'jobs.js');
  const assignedBlockStart = jobs.indexOf('const notificationLogId = `${jobId}_assigned`;');
  const submittedBlockStart = jobs.indexOf('const notificationLogId = `${jobId}_submitted`;');
  assert.notEqual(assignedBlockStart, -1);
  assert.notEqual(submittedBlockStart, -1);

  const assigned = jobs.slice(assignedBlockStart, submittedBlockStart);
  assertOrder(
    assigned,
    'await notificationLogRef.create({',
    'notificationResult = await sendPushNotification(',
    'assignment notification dedup claim must happen before push send',
  );
  assert.match(assigned, /notificationData,\s*workerUserId\s*\)/);

  const submitted = jobs.slice(submittedBlockStart);
  assertOrder(
    submitted,
    'await notificationLogRef.create({',
    'const notificationResult = await sendPushNotification(',
    'submission notification dedup claim must happen before push send',
  );
  assert.match(submitted, /notificationData,\s*managerUserId\s*\)/);
});

test('support message records keep one canonical senderRole field', () => {
  const support = readRepoFile('functions', 'src', 'support.js');
  const messageWriteStart = support.indexOf('tx.set(messageRef, {');
  assert.notEqual(messageWriteStart, -1);
  const messageWrite = support.slice(messageWriteStart, support.indexOf('});', messageWriteStart));
  assert.equal((messageWrite.match(/\bsenderRole:/g) || []).length, 1);
  assert.match(messageWrite, /\bsenderProfileRole:/);
});

test('callable internal errors do not echo raw exception messages', () => {
  const files = [
    readRepoFile('functions', 'src', 'auth.js'),
    readRepoFile('functions', 'src', 'documents.js'),
    readRepoFile('functions', 'src', 'tax.js'),
  ].join('\n');

  assert.doesNotMatch(files, /new HttpsError\('internal'[^)]*\$\{[^}]*\.message[^}]*\}/);
  assert.doesNotMatch(files, /new HttpsError\('internal'[^)]*\+\s*error\.message/);
});

test('inventory mutations enforce a Firestore document size budget', () => {
  const inventory = readRepoFile('functions', 'src', 'inventory.js');
  assert.match(inventory, /MAX_INVENTORY_DOC_BYTES/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(updatedParts/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(userParts/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(sanitized/);
});
