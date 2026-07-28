import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), '..', ...segments), 'utf8');
}

test('historical mobile reads paginate to completion and expose partial state', () => {
  const source = readRepoFile('phone_app', 'hooks', 'useArchiveQuery.ts');
  const archiveApi = readRepoFile('phone_app', 'lib', 'api', 'archives.ts');

  assert.match(source, /HistoricalQueryResult/);
  assert.match(source, /complete:\s*false/);
  assert.match(source, /do \{[\s\S]*afterCursor[\s\S]*\} while \(afterCursor\)/);
  assert.match(archiveApi, /do \{[\s\S]*afterCursor[\s\S]*\} while \(afterCursor\)/);
  assert.doesNotMatch(source, /ARCHIVE_READ_LIMIT|1_000/);
});

test('mobile initial cache does not bootstrap broad job/document collections', () => {
  const fetchers = readRepoFile('phone_app', 'contexts', 'cache-fetchers.ts');

  assert.doesNotMatch(fetchers, /readBootstrap\([^)]*,\s*true\s*\)/);
  assert.doesNotMatch(fetchers, /callHttpFunction/);
});

test('database optimization migration adds indexes, RLS, and RPC execute hardening', () => {
  const migrationsDir = path.resolve(process.cwd(), '..', 'packages', 'db', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  const migration = readRepoFile('packages', 'db', 'migrations', '0000_baseline.sql');
  const hardeningMigration = migration;

  assert.deepEqual(migrationFiles, ['0000_baseline.sql']);

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
  assert.doesNotMatch(migration, /\bservice_role\b/);
  assert.match(migration, /apply_inventory_movement\(UUID, UUID, NUMERIC/);
  assert.match(migration, /apply_inventory_pick_batch\(UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ\)/);
  assert.match(migration, /bump_company_sync_version\(UUID, TEXT\)/);
  assert.match(hardeningMigration, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(hardeningMigration, /ALTER FUNCTION public\.apply_inventory_movement[\s\S]*SET SCHEMA private/);
  assert.match(hardeningMigration, /CREATE OR REPLACE FUNCTION public\.apply_inventory_movement[\s\S]*SECURITY INVOKER/);
  assert.match(hardeningMigration, /REVOKE EXECUTE ON FUNCTION '\s*\|\| public_signature/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION private\.set_api_request_context[\s\S]*TO smart_job_api/);
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
