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

const databaseName = `smart_job_baseline_${randomUUID().replaceAll('-', '')}`;
assert.match(databaseName, /^[a-z0-9_]+$/);
const testUrl = new URL(parsed);
testUrl.pathname = `/${databaseName}`;
const verifier = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'verify-baseline.mjs',
);

const admin = new Client({ connectionString: adminDatabaseUrl, ssl: false });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
} finally {
  await admin.end();
}

try {
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
