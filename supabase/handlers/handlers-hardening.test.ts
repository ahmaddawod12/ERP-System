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

  assert.match(readModelHandler, /preloaded\.requester \|\| await getRequesterContext\(scope, uid\)/);
  assert.match(readModelHandler, /const isTaskOwner = String\(task\.user_id\) === uid/);
  assert.match(readModelHandler, /const canReadCompanyTask = requester\.isDev \|\| requester\.role === "manager"/);
});

test('read-model service-role list queries enforce role scoping before returning data', () => {
  const readModelHandler = readFile('supabase', 'functions', 'read-model', 'index.ts');
  const readModelTypes = readFile('supabase', 'functions', 'read-model', 'types.ts');
  const readModelAuthScope = readFile('supabase', 'functions', 'read-model', 'auth-scope.ts');

  assert.match(readModelTypes, /export type RequesterContext = \{/);
  assert.match(readModelTypes, /membershipId: string \| null/);
  assert.match(readModelTypes, /accountType: string/);
  assert.match(readModelAuthScope, /function shouldScopeJobsToMembership/);
  assert.match(readModelAuthScope, /requester\.role === "worker"/);
  assert.match(readModelAuthScope, /requester\.role === "user" && requester\.accountType !== "solo"/);
  assert.match(readModelHandler, /if \(!canReadCompanyJobs\(requester\)\) \{/);
  assert.match(readModelHandler, /\.eq\("assigned_membership_id", requester\.membershipId\)/);
  assert.match(readModelHandler, /if \(!canReadCompanyDocuments\(requester\)\) \{/);
  assert.match(readModelHandler, /if \(!canReadCompanyWorkers\(requester\)\) \{/);
});

test('read-model list filters and cursors are wired into service-role queries', () => {
  const readModelHandler = readFile('supabase', 'functions', 'read-model', 'index.ts');
  const readModelPagination = readFile('supabase', 'functions', 'read-model', 'pagination.ts');
  const readModelFilters = readFile('supabase', 'functions', 'read-model', 'filters.ts');

  assert.match(readModelPagination, /function parseReadLimit/);
  assert.match(readModelFilters, /function resolveJobDateField/);
  assert.match(readModelFilters, /function resolveDocumentDateField/);
  assert.match(readModelHandler, /normalizeStringList\(body\.status\)/);
  assert.match(readModelHandler, /\.in\("status", statuses\)/);
  assert.match(readModelHandler, /\.gte\(dateField, dateFrom\)/);
  assert.match(readModelHandler, /\.lte\(dateField, dateTo\)/);
  assert.match(readModelHandler, /\.eq\("document_type", documentType\)/);
  assert.match(readModelHandler, /getMembershipIdsForUser\(scope\.internalCompanyId, createdByUid\)/);
  assert.match(readModelHandler, /makeCursor\(getRowDateValue/);
  assert.match(readModelHandler, /jobsNextCursor = jobsResult\.nextCursor \|\| null/);
  assert.match(readModelHandler, /documentsNextCursor = docsResult\.nextCursor \|\| null/);
});

test('rate limiting fails closed when RPC is unavailable', () => {
  const helpers = readFile('supabase', 'shared-edge-helpers.ts');

  assert.match(helpers, /Rate limit RPC failed; rejecting request/);
  assert.match(helpers, /code: "unavailable"/);
  assert.doesNotMatch(helpers, /allowing request/);
});

test('company identifier resolution does not OR numeric IDs against UUID columns', () => {
  const helpers = readFile('supabase', 'shared-edge-helpers.ts');

  assert.match(helpers, /\.eq\("public_company_id", numericCandidate\)/);
  assert.match(helpers, /isUuidLike\(normalized\)/);
  assert.match(helpers, /\.eq\("id", normalized\)/);
  assert.doesNotMatch(helpers, /\.or\(`id\.eq\.\$\{normalized\},public_company_id\.eq\.\$\{numericCandidate\}`\)/);
});

test('job part usage resolves public part numbers before insert', () => {
  const jobsHandler = readFile('supabase', 'handlers', 'jobs.ts');

  assert.match(jobsHandler, /async function resolveJobPartRows/);
  assert.match(jobsHandler, /\.from\("inventory_parts"\)/);
  assert.match(jobsHandler, /\.in\("part_no", numericPartNos\)/);
  const jobInsertIndex = jobsHandler.search(/\.from\("jobs"\)\s*\.insert\(\{/);
  assert.ok(
    jobsHandler.indexOf('const resolvedPartRows = parts.length > 0') <
      jobInsertIndex,
    'createJobV1 should resolve job parts before inserting the job row',
  );
});

test('job attachment update restores existing rows if replacement insert fails', () => {
  const jobsHandler = readFile('supabase', 'handlers', 'jobs.ts');

  assert.match(jobsHandler, /Failed to load existing job attachments/);
  assert.match(jobsHandler, /Failed to restore job attachments after update failure/);
  assert.ok(
    jobsHandler.indexOf('select("storage_path, kind, uploaded_by_user_id, created_at")') <
      jobsHandler.indexOf('deleteAttachmentsError'),
    'existing attachments should be loaded before destructive replacement',
  );
});

test('inventory mutations fail closed instead of clamping negative balances', () => {
  const inventoryHandler = readFile('supabase', 'handlers', 'inventory.ts');
  const migration = readFile('packages', 'db', 'migrations', '0000_optimized_baseline.sql');

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

test('support RLS only exposes personal support threads to owner or dev', () => {
  const migration = readFile('packages', 'db', 'migrations', '0000_optimized_baseline.sql');

  assert.match(migration, /support_conversations_owner_read_policy/);
  assert.match(migration, /app_is_dev\(\) OR user_id = app_auth_uid\(\)/);
  assert.match(migration, /support_messages_owner_read_policy/);
  assert.match(migration, /c\.user_id = app_auth_uid\(\)/);
  assert.doesNotMatch(migration, /company_id IS NULL OR app_has_company_access/);
});

test('supabase hardening migration moves privileged RPC implementations behind private schema', () => {
  const hardeningMigration = readFile('packages', 'db', 'migrations', '0001_supabase_cost_perf_security_hardening.sql');

  assert.match(hardeningMigration, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(hardeningMigration, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.match(hardeningMigration, /ALTER FUNCTION public\.app_is_dev\(\) SET SCHEMA private/);
  assert.match(hardeningMigration, /ALTER POLICY jobs_company_read_policy[\s\S]*private\.app_auth_uid\(\)/);
  assert.match(hardeningMigration, /CREATE OR REPLACE FUNCTION public\.get_clients_page[\s\S]*SECURITY INVOKER/);
  assert.match(hardeningMigration, /REVOKE EXECUTE ON FUNCTION '\s*\|\| public_signature[\s\S]*FROM authenticated/);
  assert.match(hardeningMigration, /CREATE OR REPLACE FUNCTION private\.get_inventory_counts/);
});

test('read-model countOnly uses lightweight inventory counts', () => {
  const readModelHandler = readFile('supabase', 'functions', 'read-model', 'index.ts');

  assert.match(readModelHandler, /async function getInventoryCounts/);
  assert.match(readModelHandler, /rpc\("get_inventory_counts"/);
  assert.match(readModelHandler, /inventory: emptyInventoryPayload\(\)/);
  assert.ok(
    readModelHandler.indexOf('if (countOnly)') <
      readModelHandler.indexOf('const [userInventory, companyInventory] = await Promise.all'),
    'countOnly branch should return before full inventory payloads are fetched',
  );
});
