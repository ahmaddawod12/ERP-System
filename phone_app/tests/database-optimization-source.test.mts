import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), '..', ...segments), 'utf8');
}

test('read model supports opt-in clients and inventory pagination', () => {
  const readModel = readRepoFile('supabase', 'functions', 'read-model', 'index.ts');
  const sharedData = readRepoFile('supabase', 'functions', 'read-model', 'kinds', 'shared-data.ts');
  const schema = readRepoFile('website', 'src', 'lib', 'validation', 'schemas.ts');

  assert.match(readModel, /handleClients[\s\S]*nextCursor/);
  assert.match(readModel, /rpc\("get_clients_page"/);
  assert.match(readModel, /parseNumberCursor\(body\.afterCursor\)/);
  assert.match(sharedData, /getCompanyInventoryParts\(internalCompanyId: string, options: InventoryReadOptions = \{\}\)/);
  assert.match(sharedData, /getUserInventoryParts\(internalCompanyId: string, targetUid: string, options: InventoryReadOptions = \{\}\)/);
  assert.match(sharedData, /rpc\("get_company_inventory_page"/);
  assert.match(sharedData, /rpc\("get_member_inventory_page"/);
  assert.match(schema, /search: optionalText\(80\)/);
});

test('large mobile reads drain Cloud API pages', () => {
  const source = readRepoFile('phone_app', 'utils', 'read-model.ts');

  assert.match(source, /drainPages/);
  assert.match(source, /MAX_DRAIN_PAGES/);
});

test('mobile initial cache does not bootstrap broad job/document collections', () => {
  const fetchers = readRepoFile('phone_app', 'contexts', 'cache-fetchers.ts');

  assert.doesNotMatch(fetchers, /readBootstrap\([^)]*,\s*true\s*\)/);
  assert.doesNotMatch(fetchers, /callHttpFunction/);
});

test('inventory and profile cache bumps use atomic sync RPC', () => {
  const inventory = readRepoFile('supabase', 'handlers', 'inventory.ts');
  const profile = readRepoFile('supabase', 'handlers', 'profile.ts');

  assert.match(inventory, /bumpCompanySyncVersion\(companyId, "company_inventory_version", ctx\)/);
  assert.match(profile, /bumpCompanySyncVersion\(/);
  assert.doesNotMatch(inventory, /select\("company_inventory_version"\)/);
  assert.doesNotMatch(profile, /\.from\("company_sync_state"\)[\s\S]*\.update\(/);
});

test('database optimization migration adds indexes, RLS, and RPC execute hardening', () => {
  const migrationsDir = path.resolve(process.cwd(), '..', 'packages', 'db', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  const migration = readRepoFile('packages', 'db', 'migrations', '0000_optimized_baseline.sql');
  const hardeningMigration = readRepoFile('packages', 'db', 'migrations', '0001_supabase_cost_perf_security_hardening.sql');

  assert.deepEqual(migrationFiles, [
    '0000_optimized_baseline.sql',
    '0001_supabase_cost_perf_security_hardening.sql',
    '0002_phase1_read_caps.sql',
    '0003_phase1_atomic_jobs.sql',
    '0004_phase1_atomic_business_registration.sql',
    '0005_phase2_trigger_search_path.sql',
    '0006_api_security_foundation.sql',
    '0007_api_job_creation_and_storage.sql',
    '0008_pdf_supabase_storage.sql',
    '0009_bounded_upload_session_cleanup.sql',
    '0010_hardened_api_business_registration.sql',
    '0011_api_push_tokens.sql',
    '0012_hardened_api_invitations.sql',
    '0013_api_profile_updates.sql',
    '0014_api_support_conversations.sql',
    '0015_api_push_devices.sql',
    '0016_upload_session_idempotency_limits.sql',
    '0017_api_upgrade_and_contact_requests.sql',
    '0018_api_client_mutations.sql',
    '0019_api_inventory_mutations.sql',
    '0020_api_worker_mutations.sql',
    '0021_api_job_mutations.sql',
    '0022_api_document_tasks.sql',
    '0023_api_tax_callback_processing.sql',
    '0024_api_archive_retrieval.sql',
  ]);

  assert.match(migration, /company_memberships_user_active_joined_idx/);
  assert.match(migration, /jobs_company_assignee_status_finished_cursor_idx/);
  assert.match(migration, /documents_company_type_status_document_date_cursor_idx/);
  assert.match(migration, /inventory_parts_company_active_archived_part_no_idx/);
  assert.match(migration, /jobs_company_idempotency_unique[\s\S]*WHERE idempotency_key IS NOT NULL/);
  assert.match(migration, /inventory_movements_company_idempotency_unique[\s\S]*WHERE idempotency_key IS NOT NULL/);
  assert.match(migration, /tax_invoice_reservations_company_status_created_idx/);
  assert.match(migration, /tax_oauth_callbacks_session_created_idx/);
  assert.match(migration, /support_conversations_last_message_idx/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION get_clients_page/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION get_company_inventory_page/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION get_member_inventory_page/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION apply_inventory_pick_batch/);
  assert.match(migration, /ALTER TABLE app_users ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION '\s*\|\| function_signature/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION '\s*\|\| function_signature/);
  assert.match(migration, /apply_inventory_movement\(UUID, UUID, NUMERIC/);
  assert.match(migration, /apply_inventory_pick_batch\(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ\)/);
  assert.match(migration, /bump_company_sync_version\(UUID, TEXT\)/);
  assert.match(hardeningMigration, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(hardeningMigration, /ALTER FUNCTION public\.apply_inventory_movement[\s\S]*SET SCHEMA private/);
  assert.match(hardeningMigration, /CREATE OR REPLACE FUNCTION public\.apply_inventory_movement[\s\S]*SECURITY INVOKER/);
  assert.match(hardeningMigration, /REVOKE EXECUTE ON FUNCTION '\s*\|\| public_signature/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION '\s*\|\| public_signature[\s\S]*TO service_role/);
  assert.match(hardeningMigration, /documents_company_visible_created_cursor_idx/);
  assert.match(hardeningMigration, /tax_invoice_reservations_idempotency_lookup_idx/);
  assert.match(hardeningMigration, /cleanup_expired_operational_rows/);
});

test('database profiling checklist covers hot read-model paths', () => {
  const profiling = readRepoFile('packages', 'db', 'perf', 'profiling.sql');

  assert.match(profiling, /pg_stat_statements/);
  assert.match(profiling, /index_advisor/);
  assert.match(profiling, /get_clients_page/);
  assert.match(profiling, /get_company_inventory_page/);
  assert.match(profiling, /tax_invoice_reservations/);
  assert.match(profiling, /tax_oauth_callbacks/);
  assert.match(profiling, /support_conversations/);
});

test('client mutations preserve camelCase VAT number payloads', () => {
  const clients = readRepoFile('supabase', 'handlers', 'clients.ts');

  assert.match(clients, /String\(payload\.email\)\.trim\(\) !== ""/);
  assert.match(clients, /payload\?\.vatNumber \?\? payload\?\.vat_number/);
  assert.match(clients, /payload\?\.vatNumber !== undefined \|\| payload\?\.vat_number !== undefined/);
  assert.match(clients, /vatNumber: insertedClient\.vat_number/);
  assert.match(clients, /vatNumber: updatedClient\.vat_number/);
});
