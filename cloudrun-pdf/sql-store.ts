import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getSqlConnectionString, isSqlPersistenceEnabledForCloudRun } from './persistence';
import {
  hasLocalPlatformOverrides,
  isVerifiedLocalPlatform,
  type LocalMarkerReader,
} from './local-platform';

let pool: Pool | null = null;

export function isSharedSqlStoreEnabled(): boolean {
  return isSqlPersistenceEnabledForCloudRun();
}

export function getSharedSqlPool(): Pool | null {
  if (!isSharedSqlStoreEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool(resolveSqlPoolConfig());
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

export async function runSharedSqlQuery<Row extends QueryResultRow = QueryResultRow>(
  queryText: string,
  values: unknown[],
): Promise<QueryResult<Row> | null> {
  const activePool = getSharedSqlPool();
  if (!activePool) {
    return null;
  }
  return activePool.query<Row>(queryText, values);
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function databaseMaxConnections(env: NodeJS.ProcessEnv): number {
  const raw = String(env.DATABASE_MAX_CONNECTIONS || '5').trim();
  if (!/^[1-5]$/.test(raw)) {
    throw new Error('DATABASE_MAX_CONNECTIONS must be an integer between 1 and 5');
  }
  return Number(raw);
}

export function resolveSqlPoolConfig(
  env: NodeJS.ProcessEnv = process.env,
  readMarker?: LocalMarkerReader,
) {
  const connectionString = getSqlConnectionString(env);
  if (!connectionString) {
    throw new Error('SQL persistence is enabled but no database connection string is configured');
  }
  const databaseUrl = new URL(connectionString);
  const verifiedLocalPlatform = isVerifiedLocalPlatform(env, readMarker);
  if (hasLocalPlatformOverrides(env) && !verifiedLocalPlatform) {
    throw new Error('Local database overrides require the mounted local-platform marker');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
      && databaseUrl.username !== 'smart_job_pdf') {
    throw new Error('Production DATABASE_URL must authenticate as smart_job_pdf');
  }

  const sslMode = String(
    env.DATABASE_SSL_MODE || env.SMART_JOB_DATABASE_SSL_MODE || env.PGSSLMODE || 'require',
  ).trim().toLowerCase();
  if (sslMode !== 'disable' && sslMode !== 'require') {
    throw new Error('DATABASE_SSL_MODE must be disable or require');
  }
  const isLocalPlatformDatabase = verifiedLocalPlatform
    && databaseUrl.hostname === 'supabase_db_smart-job-erp-local'
    && (databaseUrl.port === '5432' || databaseUrl.port === '');
  if (sslMode === 'disable' && !isLoopback(databaseUrl.hostname) && !isLocalPlatformDatabase) {
    throw new Error('DATABASE_SSL_MODE=disable is allowed only for a loopback database');
  }
  const ca = String(env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n').trim();

  return {
    connectionString,
    max: databaseMaxConnections(env),
    ssl: sslMode === 'disable'
      ? false
      : {
          rejectUnauthorized: true,
          ...(ca ? { ca } : {}),
        },
  } as const;
}

export async function closeSharedSqlPool(): Promise<void> {
  const activePool = pool;
  pool = null;
  if (activePool) {
    await activePool.end();
  }
}
