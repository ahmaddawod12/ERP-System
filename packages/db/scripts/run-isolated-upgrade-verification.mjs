import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const adminDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!adminDatabaseUrl) throw new Error('DATABASE_URL is required');
const parsed = new URL(adminDatabaseUrl);
assert.ok(
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase()),
  'The isolated migration verifier only accepts a loopback PostgreSQL server',
);

const databaseName = `smart_job_upgrade_${randomUUID().replaceAll('-', '')}`;
assert.match(databaseName, /^[a-z0-9_]+$/);
const testUrl = new URL(parsed);
testUrl.pathname = `/${databaseName}`;
const verifier = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'verify-upgrade-from-0024.mjs',
);

const admin = new Client({ connectionString: adminDatabaseUrl, ssl: false });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
} finally {
  await admin.end();
}

try {
  const bootstrap = new Client({ connectionString: testUrl.toString(), ssl: false });
  await bootstrap.connect();
  try {
    await bootstrap.query(`
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id UUID PRIMARY KEY,
        aud TEXT,
        role TEXT,
        email TEXT,
        email_confirmed_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        is_anonymous BOOLEAN NOT NULL DEFAULT false,
        raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
      );
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN NOT NULL DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
      );
      CREATE TABLE storage.objects (
        id UUID PRIMARY KEY,
        bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
        name TEXT NOT NULL,
        owner_id UUID,
        metadata JSONB,
        user_metadata JSONB
      );
    `);
  } finally {
    await bootstrap.end();
  }

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifier], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        DATABASE_SSL_MODE: 'disable',
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Migration verifier exited from signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) throw new Error(`Migration verifier exited with code ${exitCode}`);
} finally {
  const cleanup = new Client({ connectionString: adminDatabaseUrl, ssl: false });
  await cleanup.connect();
  try {
    await cleanup.query(
      `SELECT pg_catalog.pg_terminate_backend(activity.pid)
       FROM pg_catalog.pg_stat_activity activity
       WHERE activity.datname = $1 AND activity.pid <> pg_catalog.pg_backend_pid()`,
      [databaseName],
    );
    await cleanup.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await cleanup.end();
  }
}
