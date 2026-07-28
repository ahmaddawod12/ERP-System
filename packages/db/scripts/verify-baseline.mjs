import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { Client } = pg;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = path.join(packageRoot, 'migrations');
const metadataRoot = path.join(migrationsRoot, 'meta');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl) throw new Error('DATABASE_URL is required');
const parsedUrl = new URL(databaseUrl);
assert.ok(
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname.toLowerCase()),
  'Baseline verification is destructive and only accepts a loopback database',
);

const files = (await readdir(migrationsRoot))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.deepEqual(files, ['0000_baseline.sql'], 'exactly one SQL baseline is required');

const journal = JSON.parse(await readFile(path.join(metadataRoot, '_journal.json'), 'utf8'));
assert.deepEqual(
  journal.entries,
  [{
    idx: 0,
    version: '7',
    when: 1785068291000,
    tag: '0000_baseline',
    breakpoints: true,
  }],
  'Drizzle journal must contain only the consolidated baseline',
);

const snapshots = (await readdir(metadataRoot))
  .filter((name) => name.endsWith('_snapshot.json'))
  .sort();
assert.deepEqual(snapshots, ['0000_snapshot.json'], 'exactly one Drizzle snapshot is required');
const snapshot = JSON.parse(await readFile(path.join(metadataRoot, snapshots[0]), 'utf8'));
assert.equal(
  snapshot.prevId,
  '00000000-0000-0000-0000-000000000000',
  'baseline snapshot must not depend on historical metadata',
);

const client = new Client({
  connectionString: databaseUrl,
  application_name: 'smart-job-baseline-verifier',
  ssl: false,
});

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
      UNION ALL
      SELECT 'function',
             namespace.nspname || '.' || procedure.proname || ':'
               || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ':'
               || pg_catalog.pg_get_function_result(procedure.oid)
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname IN ('public', 'private')
    )
    SELECT kind, value FROM catalog ORDER BY kind, value
  `);
  return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
}

await client.connect();
try {
  const database = drizzle(client);
  await migrate(database, { migrationsFolder: migrationsRoot });

  const verification = await client.query(`
    SELECT
      (
        SELECT pg_catalog.count(*) = 1
        FROM drizzle.__drizzle_migrations
      ) AS one_migration_recorded,
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
      ) AS tax_rpc_present,
      pg_catalog.has_function_privilege(
        'smart_job_api',
        'private.list_api_company_archives_v2(uuid,character varying,timestamptz,timestamptz,integer,timestamptz,uuid)',
        'EXECUTE'
      ) AS archive_list_v2_present,
      pg_catalog.has_function_privilege(
        'smart_job_api', 'private.get_api_company_archive_run(uuid,uuid)', 'EXECUTE'
      ) AS archive_exact_present,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smart_job_backup'
      ) AS backup_role_present,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger
        WHERE tgname = 'documents_payment_metadata_guard' AND NOT tgisinternal
      ) AS payment_guard_present,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension extension_row
        INNER JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = extension_row.extnamespace
        WHERE extension_row.extname = 'pg_trgm' AND namespace.nspname = 'extensions'
      ) AS trigram_extension_present
  `);
  assert.deepEqual(verification.rows[0], {
    one_migration_recorded: true,
    requested_by_present: true,
    pdf_rpc_present: true,
    email_rpc_present: true,
    tax_rpc_present: true,
    archive_list_v2_present: true,
    archive_exact_present: true,
    backup_role_present: true,
    payment_guard_present: true,
    trigram_extension_present: true,
  });

  const beforeReplay = await schemaFingerprint();
  await migrate(database, { migrationsFolder: migrationsRoot });
  assert.equal(
    await schemaFingerprint(),
    beforeReplay,
    're-running Drizzle migrate must not change the baseline schema',
  );
  const migrationCount = await client.query(
    'SELECT pg_catalog.count(*)::INTEGER AS count FROM drizzle.__drizzle_migrations',
  );
  assert.equal(migrationCount.rows[0].count, 1);

  process.stdout.write('Verified the single Drizzle baseline and its critical database surface.\n');
} finally {
  await client.end();
}
