import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile archive queries use the Cloud API archive content route', () => {
  const source = readProjectFile('hooks', 'useArchiveQuery.ts');

  assert.match(source, /archives\/content/);
  assert.match(source, /year=.*month=.*dataType=/);
  assert.match(source, /ArchiveContentResponseSchema/);
  assert.doesNotMatch(source, /httpsCallable/);
  assert.doesNotMatch(source, /fetchArchiveMonthV1/);
});
