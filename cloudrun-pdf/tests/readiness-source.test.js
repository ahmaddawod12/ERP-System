const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PDF health and readiness endpoints have separate dependency semantics', () => {
  const sourceRoot = path.resolve(__dirname, '..', '..');
  const index = fs.readFileSync(path.join(sourceRoot, 'index.ts'), 'utf8');
  const sql = fs.readFileSync(path.join(sourceRoot, 'sql-store.ts'), 'utf8');
  const storage = fs.readFileSync(
    path.join(sourceRoot, 'company-file-storage.ts'),
    'utf8',
  );
  assert.match(index, /app\.get\('\/healthz', liveness\)/);
  assert.match(index, /app\.get\('\/health', liveness\)/);
  assert.match(index, /app\.get\('\/readyz'/);
  assert.match(index, /getBrowser\(\)/);
  assert.match(index, /checkSharedSqlReadiness\(\)/);
  assert.match(index, /companyFileStorage\.checkReadiness\(\)/);
  assert.match(index, /setTimeout\([^]*5_000/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /private\.claim_pdf_document_task\(text,uuid,integer\)/);
  assert.doesNotMatch(sql, /private\.claim_document_task/);
  assert.match(storage, /bucket\.getMetadata\(\)/);
  assert.match(storage, /ifGenerationMatch:\s*0/);
  assert.doesNotMatch(index, /response\.status\(503\).*error\.message/s);
});
