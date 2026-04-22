const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'functions', 'package.json'))) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve repo root from ${__dirname}`);
}

function readRepoFile(...segments) {
  const resolvedPath = path.resolve(resolveRepoRoot(), ...segments);
  if (fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, 'utf8');
  }

  if (resolvedPath.endsWith('.js')) {
    const tsPath = resolvedPath.slice(0, -3) + '.ts';
    if (fs.existsSync(tsPath)) {
      return fs.readFileSync(tsPath, 'utf8');
    }
  }

  throw new Error(`Unable to read repo file: ${resolvedPath}`);
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
    'const membershipWorkerSnap = workerRef ? await tx.get(workerRef) : null;',
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

test('sql job flows keep inventory deduction inside the SQL transaction', () => {
  const sqlJobs = readRepoFile('packages', 'db', 'jobs.js');
  const createStart = sqlJobs.indexOf('async function createJob');
  const updateStart = sqlJobs.indexOf('async function updateJob');
  const acceptStart = sqlJobs.indexOf('async function acceptJob');

  assert.notEqual(createStart, -1);
  assert.notEqual(updateStart, -1);
  assert.notEqual(acceptStart, -1);

  const createBlock = sqlJobs.slice(createStart, updateStart);
  assertOrder(
    createBlock,
    'await replaceJobPartUsages(tx, jobRow.id, company.id, input.partsUsed || [], now);',
    'await deductUserInventoryPartsInTransaction(tx, company.id, {',
    'createJob must deduct inventory inside the SQL transaction after persisting part usage rows',
  );

  const acceptBlock = sqlJobs.slice(acceptStart);
  assertOrder(
    acceptBlock,
    'const partUsageRows = await getPersistedJobPartUsages(tx, jobRow.id);',
    'await tx.update(jobs).set({',
    'acceptJob must resolve persisted part usage rows before the final finished-state update',
  );
  assert.match(acceptBlock, /await deductUserInventoryPartsInTransaction\(tx, company\.id, \{/);

  const functionJobs = readRepoFile('functions', 'src', 'jobs.js');
  const acceptSqlStart = functionJobs.indexOf('if (isSqlPersistenceEnabled()) {');
  const acceptSqlEnd = functionJobs.indexOf('const dbRef = admin.firestore();', acceptSqlStart);
  assert.notEqual(acceptSqlStart, -1);
  assert.notEqual(acceptSqlEnd, -1);
  const acceptSqlBlock = functionJobs.slice(acceptSqlStart, acceptSqlEnd);
  assert.doesNotMatch(acceptSqlBlock, /await deductUserInventoryPartsInSql\(/);
});

test('sql inline notification flows finalize dedup records after sending pushes', () => {
  const jobs = readRepoFile('functions', 'src', 'jobs.js');

  const sqlAssignedStart = jobs.indexOf('const notifLogRef = admin.firestore().doc(`notificationLog/${result.jobId}_assigned`);');
  const sqlAssignedEnd = jobs.indexOf('    return {', sqlAssignedStart);
  assert.notEqual(sqlAssignedStart, -1);
  assert.notEqual(sqlAssignedEnd, -1);
  const sqlAssigned = jobs.slice(sqlAssignedStart, sqlAssignedEnd);
  assertOrder(
    sqlAssigned,
    'await notifLogRef.create({',
    'const notificationResult = await sendPushNotification(',
    'sql assignment notification must still claim dedup before push send',
  );
  assertOrder(
    sqlAssigned,
    'const notificationResult = await sendPushNotification(',
    'await finalizeNotificationLog(notifLogRef, notificationResult, notificationStartTime, {',
    'sql assignment notification must finalize the dedup log after sending',
  );

  const sqlSubmittedStart = jobs.indexOf('const notifLogRef = admin.firestore().doc(`notificationLog/${jobId}_submitted`);');
  const sqlSubmittedEnd = jobs.indexOf("    logger.info('updateJobV1: job updated in SQL'", sqlSubmittedStart);
  assert.notEqual(sqlSubmittedStart, -1);
  assert.notEqual(sqlSubmittedEnd, -1);
  const sqlSubmitted = jobs.slice(sqlSubmittedStart, sqlSubmittedEnd);
  assertOrder(
    sqlSubmitted,
    'await notifLogRef.create({',
    'const notificationResult = await sendPushNotification(',
    'sql submission notification must still claim dedup before push send',
  );
  assertOrder(
    sqlSubmitted,
    'const notificationResult = await sendPushNotification(',
    'await finalizeNotificationLog(notifLogRef, notificationResult, notificationStartTime, {',
    'sql submission notification must finalize the dedup log after sending',
  );
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

test('sql tax/document orchestration stays isolated from direct Firestore business reads', () => {
  const documents = readRepoFile('functions', 'src', 'documents.js');
  const tax = readRepoFile('functions', 'src', 'tax.js');
  const documentWorkflow = readRepoFile('functions', 'src', 'sql-document-orchestration.js');
  const taxWorkflow = readRepoFile('functions', 'src', 'sql-tax-orchestration.js');

  assert.match(documents, /\bsqlDocumentWorkflow\./);
  assert.match(tax, /\bsqlTaxWorkflow\./);
  assert.doesNotMatch(documentWorkflow, /admin\.firestore\(\)/);
  assert.doesNotMatch(taxWorkflow, /admin\.firestore\(\)/);
});

test('inventory mutations enforce a Firestore document size budget', () => {
  const inventory = readRepoFile('functions', 'src', 'inventory.js');
  assert.match(inventory, /MAX_INVENTORY_DOC_BYTES/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(updatedParts/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(userParts/);
  assert.match(inventory, /assertInventoryFitsFirestoreBudget\(sanitized/);
});

test('read-model single-record, inventory, and task reads enforce scoped authorization', () => {
  const readModel = readRepoFile('functions', 'src', 'read-model.js');
  assert.match(readModel, /return canReadFirestoreJobRecord\(profile, jobRecord\) \? jobRecord : null;/);
  assert.match(readModel, /return canReadFirestoreDocumentRecord\(profile\) \? documentRecord : null;/);
  assert.match(readModel, /await assertTargetWorkerScopedUserInCompany\(targetUid, requestedCompanyId\);/);
  assert.match(readModel, /await readFirestoreDocumentTask\(taskId, auth\.uid\)/);
  assert.match(readModel, /if \(ownerUid && ownerUid !== uid\) \{/);

  const dbReadModel = readRepoFile('packages', 'db', 'read-model.js');
  assert.match(dbReadModel, /return canReadSqlDocumentRecord\(profile\) \? documentMatch : null;/);
  assert.match(dbReadModel, /return canReadSqlJobRecord\(profile, jobMatch\) \? jobMatch : null;/);
  assert.match(dbReadModel, /async function getUserInventorySnapshot\(companyId, targetUid, options: any = \{\}\)/);
});

test('sql generate flow acquires the active task lock before allocating a pending document', () => {
  const documents = readRepoFile('functions', 'src', 'documents.js');
  assertOrder(
    documents,
    'await createDocumentTaskInSql({',
    'const pendingDocument = await sqlDocumentWorkflow.createPendingGeneratedDocument({',
    'sql generate flow must claim the active SQL task before allocating a new document number',
  );
  assert.match(documents, /taskId: sqlTaskId \|\| null,/);
  assert.match(documents, /await markDocumentTaskFailedInSql\(sqlTaskId, error\.message\);/);

  const shared = readRepoFile('functions', 'src', 'shared.js');
  assert.match(shared, /taskId: providedTaskId,/);
  assert.match(shared, /if \(!providedTaskId\) \{/);
});

test('sql job identity helpers use point lookups instead of full company list scans', () => {
  const sqlJobs = readRepoFile('functions', 'src', 'sql-jobs.js');
  assert.match(sqlJobs, /await dbModule\.getMemberByMemberNo\(companyId, wid\)/);
  assert.match(sqlJobs, /return await dbModule\.getClientByClientNo\(companyId, clientId\);/);
  assert.doesNotMatch(sqlJobs, /await dbModule\.listCompanyWorkers\(companyId\)/);
  assert.doesNotMatch(sqlJobs, /await dbModule\.listCompanyClients\(companyId\)/);
});

test('archive fetch path is explicitly disabled in SQL mode until a SQL archiver exists', () => {
  const documents = readRepoFile('functions', 'src', 'documents.js');
  assert.match(documents, /if \(isSqlPersistenceEnabled\(\)\) \{/);
  assert.match(documents, /archiveAvailable: false/);
  assert.match(documents, /archiveSource: 'firestore-only'/);
});
