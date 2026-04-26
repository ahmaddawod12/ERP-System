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
    if (fs.existsSync(path.join(candidate, 'cloudrun-pdf', 'package.json'))) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve repo root from ${__dirname}`);
}

function readSource(fileName) {
  return fs.readFileSync(path.resolve(resolveRepoRoot(), 'cloudrun-pdf', fileName), 'utf8');
}

test('cloudrun persistence resolver honors the same SQL activation envs as functions', () => {
  const persistence = readSource('persistence.ts');
  assert.match(persistence, /SMART_JOB_PERSISTENCE_BACKEND/);
  assert.match(persistence, /SMART_JOB_DATABASE_URL/);
  assert.match(persistence, /DATABASE_URL/);
  assert.match(persistence, /SMART_JOB_PERSISTENCE_BACKEND must be set explicitly in production/);

  const storeFiles = [
    readSource('task-store.ts'),
    readSource('access-store.ts'),
    readSource('document-store.ts'),
    readSource('company-sync-store.ts'),
  ].join('\n');
  const sharedStore = readSource('sql-store.ts');

  assert.match(sharedStore, /new Pool\(/);
  assert.match(sharedStore, /getSqlConnectionString/);
  assert.match(sharedStore, /isSqlPersistenceEnabledForCloudRun/);
  assert.match(storeFiles, /runSharedSqlQuery/);
  assert.doesNotMatch(storeFiles, /Boolean\(String\(process\.env\.DATABASE_URL \|\| ''\)\.trim\(\)\)/);
  assert.doesNotMatch(storeFiles, /new Pool\(/);
});