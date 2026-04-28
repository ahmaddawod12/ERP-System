import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile archive queries use backend archive retrieval callable', () => {
  const source = readProjectFile('hooks', 'useArchiveQuery.ts');

  assert.match(source, /httpsCallable\(functions, 'fetchArchiveMonthV1'\)/);
  assert.match(source, /companyId,\s*year,\s*month,\s*dataType/);
});
