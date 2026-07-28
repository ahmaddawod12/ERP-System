const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const workerStoreSource = fs.readFileSync(path.resolve(__dirname, '../worker-store.js'), 'utf8');
const storageSource = fs.readFileSync(path.resolve(__dirname, '../company-file-storage.js'), 'utf8');
const storageWorkflowSource = fs.readFileSync(path.resolve(__dirname, '../pdf-storage-workflow.js'), 'utf8');

function assertOrder(haystack, firstNeedle, secondNeedle, message) {
  const first = haystack.indexOf(firstNeedle);
  const second = haystack.indexOf(secondNeedle);
  assert.notEqual(first, -1, `Missing first marker: ${firstNeedle}`);
  assert.notEqual(second, -1, `Missing second marker: ${secondNeedle}`);
  assert.ok(first < second, message);
}

test('generate tasks use a bounded database processing lease', () => {
  assert.match(source, /DOCUMENT_TASK_PROCESSING_LEASE_SECONDS/);
  assert.match(source, /claimPdfDocumentTask/);
  assert.match(workerStoreSource, /private\.claim_pdf_document_task/);
  assert.match(workerStoreSource, /randomUUID/);
});

test('generated PDFs use byte-verified create-only storage and lease-guarded RPC finalization', () => {
  assert.match(storageSource, /ifGenerationMatch:\s*0/);
  assert.match(storageSource, /verifyExistingPdf/);
  assert.match(source, /completePdfDocumentTask/);
  assert.match(workerStoreSource, /private\.complete_pdf_document_task/);
  assert.match(workerStoreSource, /task\.internalCompanyId/);
  assert.match(workerStoreSource, /task\.internalDocumentId/);
  assert.doesNotMatch(workerStoreSource, /UPDATE public\.|INSERT INTO public\.|DELETE FROM public\./);
  assert.doesNotMatch(source, /@postgres\/postgres-js|client\.storage/);
});

test('generated PDF is retained when SQL finalization has an ambiguous outcome', () => {
  assertOrder(
    storageWorkflowSource,
    'storePdfCreateOnly',
    'options.finalize',
    'object must be stored before SQL finalization',
  );
  assert.doesNotMatch(storageWorkflowSource, /removeObject/);
  assert.match(source, /failPdfDocumentTask/);
});
