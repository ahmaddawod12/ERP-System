const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Full lease-token behavior is exercised against local Postgres by
// packages/db/tests/api-security-foundation.integration.test.mjs. This local
// package test prevents the PDF service from regressing to direct table writes.
test('worker persistence boundary contains only private lease-token RPCs', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../worker-store.js'), 'utf8');
  assert.match(source, /private\.claim_pdf_document_task/);
  assert.match(source, /private\.complete_pdf_document_task/);
  assert.match(source, /private\.fail_pdf_document_task/);
  assert.match(source, /leaseToken/);
  assert.doesNotMatch(source, /(?:SELECT|UPDATE|INSERT|DELETE)[\s\S]{0,80}public\./i);
});
