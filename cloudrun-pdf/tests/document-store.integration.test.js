const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');
const { Client } = require('pg');

const {
  completeDocumentGeneration,
  resolveCompanyStorageContext,
  resolveDocumentStorageContext,
} = require('../document-store');
const { closeSharedSqlPool } = require('../sql-store');
const { buildGeneratedDocumentObjectPath } = require('../storage-paths');

const enabled = Boolean(
  process.env.SMART_JOB_PDF_SQL_INTEGRATION
  && (process.env.DATABASE_URL || process.env.SMART_JOB_DATABASE_URL),
);
const databaseUrl = String(process.env.DATABASE_URL || process.env.SMART_JOB_DATABASE_URL || '');
const fixture = {
  userId: randomUUID(),
  companyId: randomUUID(),
  documentId: randomUUID(),
  rollbackDocumentId: randomUUID(),
  publicCompanyId: 8_500_000_000_000 + randomInt(10_000_000),
};

let admin;

before(async () => {
  if (!enabled) return;
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname));
  admin = new Client({ connectionString: databaseUrl, ssl: false });
  await admin.connect();
  await admin.query(
    `INSERT INTO app_users (id, email, display_name)
     VALUES ($1, $2, 'PDF storage fixture')`,
    [fixture.userId, `pdf-${fixture.userId}@example.invalid`],
  );
  await admin.query(
    `INSERT INTO companies (
       id, public_company_id, account_type, status, created_by_user_id
     ) VALUES ($1, $2, 'business', 'active', $3)`,
    [fixture.companyId, fixture.publicCompanyId, fixture.userId],
  );
  await admin.query(
    'INSERT INTO company_sync_state (company_id) VALUES ($1)',
    [fixture.companyId],
  );
  await admin.query(
    `INSERT INTO documents (
       id, company_id, document_type, document_number, document_code,
       generation_status, payload
     ) VALUES
       ($1, $3, 400, 1, 'PDF-DOC-1', 'pending', '{}'::jsonb),
       ($2, $3, 400, 2, 'PDF-DOC-2', 'pending', '{}'::jsonb)`,
    [fixture.documentId, fixture.rollbackDocumentId, fixture.companyId],
  );
});

after(async () => {
  if (!enabled) return;
  await closeSharedSqlPool();
  await admin.query('DELETE FROM companies WHERE id = $1', [fixture.companyId]).catch(() => undefined);
  await admin.query('DELETE FROM app_users WHERE id = $1', [fixture.userId]).catch(() => undefined);
  await admin.end();
});

test('SQL finalization normalizes the tenant, is replay-safe, and bumps sync exactly once', {
  skip: !enabled,
}, async () => {
  const company = await resolveCompanyStorageContext(fixture.publicCompanyId);
  assert.equal(company.internalCompanyId, fixture.companyId);
  const document = await resolveDocumentStorageContext(
    fixture.publicCompanyId,
    'PDF-DOC-1',
    400,
  );
  assert.equal(document.internalDocumentId, fixture.documentId);
  const objectPath = buildGeneratedDocumentObjectPath(
    document.internalCompanyId,
    document.internalDocumentId,
  );

  const first = await completeDocumentGeneration({
    internalCompanyId: document.internalCompanyId,
    internalDocumentId: document.internalDocumentId,
    storagePath: objectPath,
    documentType: 400,
  });
  assert.deepEqual(first, { finalized: true });
  const replay = await completeDocumentGeneration({
    internalCompanyId: document.internalCompanyId,
    internalDocumentId: document.internalDocumentId,
    storagePath: objectPath,
    documentType: 400,
  });
  assert.deepEqual(replay, { finalized: false });

  await assert.rejects(
    completeDocumentGeneration({
      internalCompanyId: document.internalCompanyId,
      internalDocumentId: document.internalDocumentId,
      storagePath: `${document.internalCompanyId}/documents/different.pdf`,
      documentType: 400,
    }),
    (error) => error?.code === 'document_finalization_conflict',
  );

  const stored = await admin.query(
    `SELECT document.storage_path, document.generation_status, sync.documents_version
     FROM documents AS document
     INNER JOIN company_sync_state AS sync ON sync.company_id = document.company_id
     WHERE document.id = $1`,
    [fixture.documentId],
  );
  assert.deepEqual(stored.rows[0], {
    storage_path: objectPath,
    generation_status: 'completed',
    documents_version: 1,
  });
});

test('missing sync state rolls back document finalization atomically', {
  skip: !enabled,
}, async () => {
  await admin.query('DELETE FROM company_sync_state WHERE company_id = $1', [fixture.companyId]);
  const objectPath = buildGeneratedDocumentObjectPath(fixture.companyId, fixture.rollbackDocumentId);
  await assert.rejects(
    completeDocumentGeneration({
      internalCompanyId: fixture.companyId,
      internalDocumentId: fixture.rollbackDocumentId,
      storagePath: objectPath,
      documentType: 400,
    }),
    /sync state is missing/,
  );
  const stored = await admin.query(
    'SELECT storage_path, generation_status FROM documents WHERE id = $1',
    [fixture.rollbackDocumentId],
  );
  assert.deepEqual(stored.rows[0], { storage_path: null, generation_status: 'pending' });
});

