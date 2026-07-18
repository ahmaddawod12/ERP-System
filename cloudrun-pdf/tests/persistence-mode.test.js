const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot() {
  const candidates = [path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..', '..', '..')];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'cloudrun-pdf', 'package.json'))) return candidate;
  }
  throw new Error(`Unable to resolve repo root from ${__dirname}`);
}

function readSource(fileName) {
  return fs.readFileSync(path.resolve(resolveRepoRoot(), 'cloudrun-pdf', fileName), 'utf8');
}

test('PDF persistence is SQL-only and the worker uses one shared least-privilege pool', () => {
  const persistence = readSource('persistence.ts');
  assert.match(persistence, /SMART_JOB_PERSISTENCE_BACKEND/);
  assert.match(persistence, /DATABASE_URL/);
  assert.match(persistence, /Firestore persistence is no longer supported/);
  assert.match(persistence, /SMART_JOB_PERSISTENCE_BACKEND must be set explicitly in production/);

  const sharedStore = readSource('sql-store.ts');
  const workerStore = readSource('worker-store.ts');
  assert.match(sharedStore, /new Pool\(/);
  assert.match(sharedStore, /DATABASE_MAX_CONNECTIONS/);
  assert.match(sharedStore, /smart_job_pdf/);
  assert.match(sharedStore, /DATABASE_SSL_MODE=disable is allowed only for a loopback database/);
  assert.match(workerStore, /runSharedSqlQuery/);
  assert.doesNotMatch(workerStore, /new Pool\(/);
  assert.doesNotMatch(workerStore, /public\.(?:documents|document_tasks)/);
});

test('production PDF configuration requires the dedicated login role and bounded pool', () => {
  const { resolveSqlPoolConfig } = require('../sql-store.js');
  const local = resolveSqlPoolConfig({
    NODE_ENV: 'test',
    SMART_JOB_PERSISTENCE_BACKEND: 'sql',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
    DATABASE_SSL_MODE: 'disable',
    DATABASE_MAX_CONNECTIONS: '3',
  });
  assert.equal(local.max, 3);
  assert.equal(local.ssl, false);

  assert.throws(() => resolveSqlPoolConfig({
    NODE_ENV: 'production',
    SMART_JOB_PERSISTENCE_BACKEND: 'sql',
    DATABASE_URL: 'postgresql://postgres:secret@db.example.test/postgres',
    DATABASE_SSL_MODE: 'require',
  }), /smart_job_pdf/);
  assert.throws(() => resolveSqlPoolConfig({
    NODE_ENV: 'test',
    SMART_JOB_PERSISTENCE_BACKEND: 'sql',
    DATABASE_URL: 'postgresql://smart_job_pdf:secret@db.example.test/postgres',
    DATABASE_SSL_MODE: 'disable',
  }), /loopback/);
});
