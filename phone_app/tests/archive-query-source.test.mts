import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile archive queries use period pagination and exact typed run downloads', () => {
  const source = readProjectFile('hooks', 'useArchiveQuery.ts');
  const api = readProjectFile('lib', 'api', 'archives.ts');
  const period = readProjectFile('lib', 'history', 'archive-period-model.ts');

  assert.match(source, /loadArchivePeriod/);
  assert.match(api, /fetchArchivePeriodRuns/);
  assert.match(api, /year/);
  assert.match(api, /month/);
  assert.match(period, /storageGeneration/);
  assert.match(period, /manifestFingerprint/);
  assert.match(period, /mapWithConcurrency\(\s*readyRuns,\s*3/);
  assert.match(api, /ArchiveListPageSchema/);
  assert.match(api, /ArchiveRunDownloadSchema/);
  assert.doesNotMatch(source, /ARCHIVE_READ_LIMIT/);
  assert.doesNotMatch(api, /MAX_ARCHIVE_LOOKUP_PAGES/);
  assert.doesNotMatch(source, /archives\/content/);
  assert.doesNotMatch(source, /httpsCallable/);
  assert.doesNotMatch(source, /fetchArchiveMonthV1/);
});
