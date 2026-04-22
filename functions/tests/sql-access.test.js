const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSqlAccessHelpers() {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/sql-access.ts'), 'utf8');
  const start = source.indexOf('function resolveSqlPersistenceBackend');
  const end = source.indexOf('function loadDbModule');
  assert.notEqual(start, -1, 'resolveSqlPersistenceBackend definition not found');
  assert.notEqual(end, -1, 'loadDbModule definition not found');
  const executableSource = source.slice(start, end);

  const sandbox = {
    module: { exports: {} },
    exports: {},
    process: { env: {} },
  };
  vm.runInNewContext(`${executableSource}\nmodule.exports = { isSqlPersistenceEnabled, resolveSqlPersistenceBackend };`, sandbox);
  return sandbox.module.exports;
}

const {
  isSqlPersistenceEnabled,
  resolveSqlPersistenceBackend,
} = loadSqlAccessHelpers();

test('resolveSqlPersistenceBackend defaults to firestore without SQL configuration', () => {
  assert.equal(resolveSqlPersistenceBackend({}), 'firestore');
  assert.equal(isSqlPersistenceEnabled({}), false);
});

test('resolveSqlPersistenceBackend auto-switches to sql when DATABASE_URL is present', () => {
  const env = { DATABASE_URL: 'postgres://smart-job:test@localhost:5432/smart_job' };
  assert.equal(resolveSqlPersistenceBackend(env), 'sql');
  assert.equal(isSqlPersistenceEnabled(env), true);
});

test('resolveSqlPersistenceBackend also honors SMART_JOB_DATABASE_URL and PERSISTENCE_BACKEND', () => {
  const viaSmartJobUrl = { SMART_JOB_DATABASE_URL: 'postgres://smart-job:test@localhost:5432/smart_job' };
  assert.equal(resolveSqlPersistenceBackend(viaSmartJobUrl), 'sql');
  assert.equal(isSqlPersistenceEnabled(viaSmartJobUrl), true);

  const viaLegacyOverride = { PERSISTENCE_BACKEND: 'sql' };
  assert.equal(resolveSqlPersistenceBackend(viaLegacyOverride), 'sql');
  assert.equal(isSqlPersistenceEnabled(viaLegacyOverride), true);
});

test('resolveSqlPersistenceBackend honors explicit override', () => {
  const env = {
    DATABASE_URL: 'postgres://smart-job:test@localhost:5432/smart_job',
    SMART_JOB_PERSISTENCE_BACKEND: 'firestore',
  };
  assert.equal(resolveSqlPersistenceBackend(env), 'firestore');
  assert.equal(isSqlPersistenceEnabled(env), false);
});

test('resolveSqlPersistenceBackend honors explicit sql override without DATABASE_URL', () => {
  const env = {
    SMART_JOB_PERSISTENCE_BACKEND: 'sql',
  };
  assert.equal(resolveSqlPersistenceBackend(env), 'sql');
  assert.equal(isSqlPersistenceEnabled(env), true);
});