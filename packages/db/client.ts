import { readDatabaseConfig, resolvePersistenceBackend } from './config';
import * as schema from './schema';
    import { Pool } from 'pg';
    import { drizzle } from 'drizzle-orm/node-postgres';

let sharedPool = null;
let sharedDb = null;

function buildPoolConfig(env = process.env) {
  const config = readDatabaseConfig(env);
  return {
    connectionString: config.connectionString,
    max: config.maxConnections,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.sslMode === 'require'
      ? {
        rejectUnauthorized: config.sslRejectUnauthorized,
        ca: config.sslCa || undefined,
      }
      : false,
  };
}

function getDb(env = process.env) {
  const backend = resolvePersistenceBackend(env);
  if (backend !== 'sql') {
    throw new Error(`Cannot create SQL client while persistence backend is ${backend}`);
  }

  if (!sharedDb) {

    sharedPool = new Pool(buildPoolConfig(env));
    sharedDb = drizzle(sharedPool, { schema });
  }

  return sharedDb;
}

async function closeDb() {
  if (sharedPool) {
    await sharedPool.end();
  }
  sharedPool = null;
  sharedDb = null;
}

export { buildPoolConfig, closeDb, getDb };
