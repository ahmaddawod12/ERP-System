import { Pool, type PoolClient, type QueryResult } from 'pg';
import { getSqlConnectionString, isSqlPersistenceEnabledForCloudRun } from './persistence';

let pool: Pool | null = null;

export function isSharedSqlStoreEnabled(): boolean {
  return isSqlPersistenceEnabledForCloudRun();
}

export function getSharedSqlPool(): Pool | null {
  if (!isSharedSqlStoreEnabled()) {
    return null;
  }

  const connectionString = getSqlConnectionString();
  if (!connectionString) {
    throw new Error('SQL persistence is enabled but no database connection string is configured');
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
    });
  }

  return pool;
}

export async function connectSharedSqlClient(): Promise<PoolClient | null> {
  const activePool = getSharedSqlPool();
  if (!activePool) {
    return null;
  }
  return activePool.connect();
}

export async function runSharedSqlQuery(queryText: string, values: unknown[]): Promise<QueryResult | null> {
  const activePool = getSharedSqlPool();
  if (!activePool) {
    return null;
  }
  return activePool.query(queryText, values);
}

export async function closeSharedSqlPool(): Promise<void> {
  const activePool = pool;
  pool = null;
  if (activePool) {
    await activePool.end();
  }
}
