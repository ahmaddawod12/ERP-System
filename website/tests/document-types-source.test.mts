import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('website document types re-export contract constants used by documents page', () => {
  const source = readProjectFile('src', 'lib', 'document-types.ts');

  assert.match(source, /export \{ DOC_TYPE, VAT_RATE \}/);
  assert.match(source, /export const VAT_RATE_PERCENT = Math\.round\(VAT_RATE \* 100\)/);
});
