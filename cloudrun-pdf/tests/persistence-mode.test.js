const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSource(fileName) {
  return fs.readFileSync(path.resolve(__dirname, '..', fileName), 'utf8');
}

test('cloudrun persistence resolver honors the same SQL activation envs as functions', () => {
  const persistence = readSource('persistence.ts');
  assert.match(persistence, /SMART_JOB_PERSISTENCE_BACKEND/);
  assert.match(persistence, /SMART_JOB_DATABASE_URL/);
  assert.match(persistence, /DATABASE_URL/);

  const storeFiles = [
    readSource('task-store.ts'),
    readSource('access-store.ts'),
    readSource('document-store.ts'),
    readSource('company-sync-store.ts'),
  ].join('\n');

  assert.match(storeFiles, /isSqlPersistenceEnabledForCloudRun/);
  assert.match(storeFiles, /getSqlConnectionString/);
  assert.doesNotMatch(storeFiles, /Boolean\(String\(process\.env\.DATABASE_URL \|\| ''\)\.trim\(\)\)/);
});