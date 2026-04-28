import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function readFile(...segments: string[]) {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

test('job file signed URLs require exact job attachment lookup', () => {
  const jobsHandler = readFile('supabase', 'handlers', 'jobs.ts');

  assert.match(jobsHandler, /from\("job_attachments"\)/);
  assert.match(jobsHandler, /\.eq\("job_id", String\(job.id\)\)/);
  assert.match(jobsHandler, /\.eq\("storage_path", normalizedStoragePath\)/);
});

test('document task publishing dispatches Cloud Run only for newly created tasks', () => {
  const documentsHandler = readFile('supabase', 'handlers', 'documents.ts');
  const taxHandler = readFile('supabase', 'handlers', 'tax.ts');

  assert.match(documentsHandler, /return \{ \.\.\.insertedTask, isNew: true \}/);
  assert.match(documentsHandler, /buildDocumentTaskLockKey\(taskType, documentType, documentId, requestPayload\)/);
  assert.match(documentsHandler, /sha256Hex\(`\$\{taskType\}:\$\{documentType\}:\$\{normalizedPayload\}`\)/);
  assert.match(documentsHandler, /if \(task\.isNew\) \{[\s\S]*dispatchCloudRunPdfTask\("\/preview"/);
  assert.match(documentsHandler, /if \(task\.isNew\) \{[\s\S]*dispatchCloudRunPdfTask\("\/generate"/);
  assert.match(taxHandler, /if \(task\.isNew\) \{[\s\S]*dispatchCloudRunPdfTask\("\/generate"/);
});

test('archive month retrieval is implemented through backend-controlled storage access', () => {
  const documentsHandler = readFile('supabase', 'handlers', 'documents.ts');

  assert.match(documentsHandler, /ARCHIVE_BUCKET is not configured/);
  assert.match(documentsHandler, /https:\/\/storage\.googleapis\.com\/storage\/v1\/b\//);
  assert.doesNotMatch(documentsHandler, /replace\(\/%2F\/g, "\/"\)/);
  assert.match(documentsHandler, /success: true,/);
  assert.match(documentsHandler, /items: items \|\| \[\]/);
});
