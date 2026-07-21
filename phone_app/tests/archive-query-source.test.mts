import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile archive queries use the exact typed archive-run route', () => {
  const source = readProjectFile('hooks', 'useArchiveQuery.ts');
  const api = readProjectFile('lib', 'api', 'archives.ts');

  assert.match(source, /findArchiveRun/);
  assert.match(source, /downloadArchiveRun/);
  assert.match(api, /ArchiveListPageSchema/);
  assert.match(api, /ArchiveRunDownloadSchema/);
  assert.doesNotMatch(source, /archives\/content/);
  assert.doesNotMatch(source, /httpsCallable/);
  assert.doesNotMatch(source, /fetchArchiveMonthV1/);
});
