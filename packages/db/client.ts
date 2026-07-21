import { readDatabaseConfig, resolvePersistenceBackend } from './config';
import * as schema from './schema';
import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export type SmartJobDatabase = NodePgDatabase<typeof schema>;
export type SmartJobTransaction = Parameters<
  Parameters<SmartJobDatabase['transaction']>[0]
>[0];
export type SmartJobQueryExecutor = SmartJobDatabase | SmartJobTransaction;
export type DatabaseOptions<TDb extends SmartJobQueryExecutor = SmartJobDatabase> = {
  db?: TDb;
  env?: NodeJS.ProcessEnv;
};

let sharedPool: Pool | null = null;
let sharedDb: SmartJobDatabase | null = null;

function buildPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const config = readDatabaseConfig(env);
  if (!config) {
    throw new Error('DATABASE_URL is required when SQL persistence is enabled');
  }
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

function getDb(env: NodeJS.ProcessEnv = process.env): SmartJobDatabase {
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
