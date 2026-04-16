const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

function assertOrder(firstNeedle, secondNeedle, message) {
  const first = source.indexOf(firstNeedle);
  const second = source.indexOf(secondNeedle);
  assert.notEqual(first, -1, `Missing first marker: ${firstNeedle}`);
  assert.notEqual(second, -1, `Missing second marker: ${secondNeedle}`);
  assert.ok(first < second, message);
}

test('generate tasks reclaim stale processing records instead of getting stuck forever', () => {
  assert.match(source, /PROCESSING_STALE_AFTER_MS/);
  assert.match(source, /Reclaiming stale processing task/);
});

test('new generated PDFs use create-only storage and Firestore writes', () => {
  assert.match(source, /preconditionOpts:\s*\{\s*ifGenerationMatch:\s*0\s*\}/);
  assert.match(source, /await documentRef\.create\(buildStoredDocumentRecord/);
});

test('generated PDF is deleted when Firestore finalization fails', () => {
  assertOrder('savedGeneratedFile = file;', 'documentFinalized = true;', 'file must be tracked before finalization');
  assert.match(source, /savedGeneratedFile && !documentFinalized/);
  assert.match(source, /Deleted orphaned generated PDF after finalize failure/);
});
