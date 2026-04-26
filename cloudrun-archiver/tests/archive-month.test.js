const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function resolveProjectFile(...segments) {
  const candidates = [
    path.resolve(__dirname, '..', ...segments),
    path.resolve(__dirname, '..', '..', ...segments),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve project file: ${segments.join('/')}`);
}

function loadGetTargetMonth() {
  const source = fs.readFileSync(resolveProjectFile('archive-month.ts'), 'utf8');
  const executableSource = source
    .replace('export function getTargetMonth', 'function getTargetMonth')
    .replace(/\): \{[\s\S]*?\} \{/, ') {');
  const sandbox = {
    module: { exports: {} },
    exports: {},
  };
  vm.runInNewContext(`${executableSource}\nmodule.exports = { getTargetMonth };`, sandbox);
  return sandbox.module.exports.getTargetMonth;
}

const getTargetMonth = loadGetTargetMonth();
const source = fs.readFileSync(resolveProjectFile('index.ts'), 'utf8');

test('getTargetMonth handles same-year lookback', () => {
  const target = getTargetMonth(new Date('2026-07-15T12:00:00.000Z'));
  assert.equal(target.year, 2026);
  assert.equal(target.month, 1);
  assert.equal(target.startDate.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(target.endDate.toISOString(), '2026-01-31T23:59:59.999Z');
});

test('getTargetMonth handles previous-year lookback', () => {
  const target = getTargetMonth(new Date('2026-03-15T12:00:00.000Z'));
  assert.equal(target.year, 2025);
  assert.equal(target.month, 9);
  assert.equal(target.startDate.toISOString(), '2025-09-01T00:00:00.000Z');
  assert.equal(target.endDate.toISOString(), '2025-09-30T23:59:59.999Z');
});

test('archiver resumes deletion from manifest doc ids instead of re-querying date ranges', () => {
  assert.match(source, /status === 'uploaded_not_deleted' && Array\.isArray\(manifest\[finishedKey\]\.docIds\)/);
  assert.match(source, /await deleteArchiveRecords\(companyId, 'finishedJobs', manifest\[finishedKey\]\.docIds\)/);
  assert.match(source, /await deleteArchiveRecords\(companyId, 'documents', manifest\[documentsKey\]\.docIds\)/);
});

test('archiver uses SQL-backed archives without Firestore fallback branches', () => {
  assert.match(source, /await listArchivedCompanyJobs\(companyId, queryOptions\)/);
  assert.match(source, /await listArchivedCompanyDocuments\(companyId, queryOptions\)/);
  assert.match(source, /companies = await listCompanyPublicIds\(\)/);
  assert.doesNotMatch(source, /db\.collection\('companies'\)/);
});
