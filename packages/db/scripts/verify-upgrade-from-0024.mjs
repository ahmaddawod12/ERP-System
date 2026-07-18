import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = path.join(packageRoot, 'migrations');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl) throw new Error('DATABASE_URL is required');
const parsedUrl = new URL(databaseUrl);
assert.ok(
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname.toLowerCase()),
  'Migration upgrade verification is destructive and only accepts a loopback database',
);

const files = (await readdir(migrationsRoot))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.equal(files[0]?.startsWith('0000_'), true, 'migration 0000 is required');
assert.equal(files.some((name) => name.startsWith('0024_')), true, 'migration 0024 is required');
assert.equal(files.some((name) => name.startsWith('0025_')), true, 'migration 0025 is required');

const client = new Client({
  connectionString: databaseUrl,
  application_name: 'smart-job-upgrade-from-0024-verifier',
  ssl: false,
});

async function applyMigration(name) {
  const sql = (await readFile(path.join(migrationsRoot, name), 'utf8'))
    .replaceAll('--> statement-breakpoint', '');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new Error(`Migration ${name} failed during 0024 upgrade verification`, { cause: error });
  }
}

async function schemaFingerprint() {
  const result = await client.query(`
    WITH catalog AS (
      SELECT 'column' AS kind,
             table_schema || '.' || table_name || '.' || column_name || ':'
               || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '') AS value
      FROM information_schema.columns
      WHERE table_schema IN ('public', 'private')
      UNION ALL
      SELECT 'constraint',
             namespace.nspname || '.' || relation.relname || '.' || constraint_row.conname
               || ':' || pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
      FROM pg_catalog.pg_constraint AS constraint_row
      INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('public', 'private')
      UNION ALL
      SELECT 'index', schemaname || '.' || indexname || ':' || indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname IN ('public', 'private')
      UNION ALL
      SELECT 'enum', namespace.nspname || '.' || type_row.typname || ':'
        || enum_row.enumsortorder::text || ':' || enum_row.enumlabel
      FROM pg_catalog.pg_enum AS enum_row
      INNER JOIN pg_catalog.pg_type AS type_row ON type_row.oid = enum_row.enumtypid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
      WHERE namespace.nspname IN ('public', 'private')
    )
    SELECT kind, value FROM catalog ORDER BY kind, value
  `);
  return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
}

await client.connect();
try {
  for (const name of files.filter((file) => Number(file.slice(0, 4)) <= 24)) {
    await applyMigration(name);
  }
  const beforeBaseline = await schemaFingerprint();
  const baseline = files.find((file) => file.startsWith('0025_'));
  assert.ok(baseline);
  await applyMigration(baseline);
  assert.equal(
    await schemaFingerprint(),
    beforeBaseline,
    '0025 metadata baseline must not mutate the schema produced by migrations through 0024',
  );

  for (const name of files.filter((file) => Number(file.slice(0, 4)) >= 26)) {
    await applyMigration(name);
  }
  const verification = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'private' AND table_name = 'tax_submissions'
          AND column_name = 'requested_by_user_id' AND is_nullable = 'NO'
      ) AS requested_by_present,
      pg_catalog.has_function_privilege(
        'smart_job_pdf', 'private.claim_pdf_document_task(text,uuid,integer)', 'EXECUTE'
      ) AS pdf_rpc_present,
      pg_catalog.has_function_privilege(
        'smart_job_email', 'private.claim_email_delivery(uuid,uuid,integer)', 'EXECUTE'
      ) AS email_rpc_present,
      pg_catalog.has_function_privilege(
        'smart_job_api', 'private.create_api_tax_invoice(uuid,jsonb,timestamptz)', 'EXECUTE'
      ) AS tax_rpc_present
  `);
  assert.deepEqual(verification.rows[0], {
    requested_by_present: true,
    pdf_rpc_present: true,
    email_rpc_present: true,
    tax_rpc_present: true,
  });
  process.stdout.write('Verified no-op 0025 baseline and upgrade path from 0024 through latest migration.\n');
} finally {
  await client.end();
}
