const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const documentStoreSource = fs.readFileSync(path.resolve(__dirname, '../document-store.js'), 'utf8');
const storageSource = fs.readFileSync(path.resolve(__dirname, '../company-file-storage.js'), 'utf8');
const storageWorkflowSource = fs.readFileSync(path.resolve(__dirname, '../pdf-storage-workflow.js'), 'utf8');

function assertOrder(haystack, firstNeedle, secondNeedle, message) {
  const first = haystack.indexOf(firstNeedle);
  const second = haystack.indexOf(secondNeedle);
  assert.notEqual(first, -1, `Missing first marker: ${firstNeedle}`);
  assert.notEqual(second, -1, `Missing second marker: ${secondNeedle}`);
  assert.ok(first < second, message);
}

test('generate tasks reclaim stale processing records instead of getting stuck forever', () => {
  assert.match(source, /PROCESSING_STALE_AFTER_MS/);
  assert.match(source, /claimSqlTaskProcessing\(/);
});

test('generated PDFs use byte-verified create-only storage and guarded SQL finalization', () => {
  assert.match(storageSource, /upsert:\s*false/);
  assert.match(storageSource, /verifyExistingPdf/);
  assert.match(source, /completeSqlDocumentGeneration/);
  assert.match(documentStoreSource, /FOR UPDATE/);
  assert.match(documentStoreSource, /row\.storage_path === null/);
  assert.match(documentStoreSource, /String\(row\.storage_path\) === normalizedPath/);
  assert.match(documentStoreSource, /documents_version = documents_version \+ 1/);
  assert.doesNotMatch(source, /@google-cloud\/storage|storage\.bucket\(/);
});

test('generated PDF is retained when SQL finalization has an ambiguous outcome', () => {
  assertOrder(
    storageWorkflowSource,
    'storePdfCreateOnly',
    'options.finalize',
    'object must be stored before SQL finalization',
  );
  assert.doesNotMatch(storageWorkflowSource, /removeObject/);
  assert.doesNotMatch(source, /savedGeneratedFile.*delete/s);
  assert.match(source, /markSqlTaskRetryable/);
});
