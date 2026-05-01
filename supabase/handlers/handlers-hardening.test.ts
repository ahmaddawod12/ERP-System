import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, (match) => match.slice(1))), '..', '..');

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
  assert.match(documentsHandler, /markDocumentTaskDispatchFailed/);
  assert.match(taxHandler, /if \(task\.isNew\) \{[\s\S]*dispatchCloudRunPdfTask\("\/generate"/);
});

test('read-model task access is restricted to task owner or manager/dev', () => {
  const readModelHandler = readFile('supabase', 'functions', 'read-model', 'index.ts');

  assert.match(readModelHandler, /const requester = await getRequesterRoleContext/);
  assert.match(readModelHandler, /const isTaskOwner = String\(task\.user_id\) === uid/);
  assert.match(readModelHandler, /const canReadCompanyTask = requester\.isDev \|\| requester\.role === "manager"/);
});

test('rate limiting fails closed when RPC is unavailable', () => {
  const helpers = readFile('supabase', 'shared-edge-helpers.ts');

  assert.match(helpers, /Rate limit RPC failed; rejecting request/);
  assert.match(helpers, /code: "unavailable"/);
  assert.doesNotMatch(helpers, /allowing request/);
});

test('job part usage resolves public part numbers before insert', () => {
  const jobsHandler = readFile('supabase', 'handlers', 'jobs.ts');

  assert.match(jobsHandler, /async function resolveJobPartRows/);
  assert.match(jobsHandler, /\.from\("inventory_parts"\)/);
  assert.match(jobsHandler, /\.in\("part_no", numericPartNos\)/);
});

test('inventory mutations fail closed instead of clamping negative balances', () => {
  const inventoryHandler = readFile('supabase', 'handlers', 'inventory.ts');
  const migration = readFile('packages', 'db', 'migrations', '0011_runtime_hardening.sql');

  assert.match(inventoryHandler, /Inventory quantity cannot be negative/);
  assert.match(inventoryHandler, /apply_inventory_movement/);
  assert.doesNotMatch(inventoryHandler, /Math\.max\(0, quantity\)/);
  assert.doesNotMatch(inventoryHandler, /Math\.max\(0, await getBalanceQuantity/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION apply_inventory_movement/);
  assert.match(migration, /RAISE EXCEPTION 'inventory_insufficient_stock'/);
});

test('invite join response exposes public worker number instead of internal membership UUID', () => {
  const invitesHandler = readFile('supabase', 'handlers', 'invites.ts');

  assert.match(invitesHandler, /wid: Number\(membership\.member_no \|\| 0\)/);
  assert.doesNotMatch(invitesHandler, /membershipId: String\(membership\.membership_id\)/);
});

test('archive month retrieval is implemented through backend-controlled storage access', () => {
  const documentsHandler = readFile('supabase', 'handlers', 'documents.ts');

  assert.match(documentsHandler, /ARCHIVE_BUCKET is not configured/);
  assert.match(documentsHandler, /https:\/\/storage\.googleapis\.com\/storage\/v1\/b\//);
  assert.doesNotMatch(documentsHandler, /replace\(\/%2F\/g, "\/"\)/);
  assert.match(documentsHandler, /success: true,/);
  assert.match(documentsHandler, /items: items \|\| \[\]/);
});
