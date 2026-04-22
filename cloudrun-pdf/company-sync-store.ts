import { Pool, type QueryResult } from 'pg';
import { getSqlConnectionString, isSqlPersistenceEnabledForCloudRun } from './persistence';

let pool: Pool | null = null;

export function isSqlCompanySyncStoreEnabled(): boolean {
  return isSqlPersistenceEnabledForCloudRun();
}

function getPool(): Pool | null {
  if (!isSqlCompanySyncStoreEnabled()) {
    return null;
  }
  const connectionString = getSqlConnectionString();
  if (!connectionString) {
    throw new Error('SQL company sync store is enabled but no database connection string is configured');
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

async function runQuery(queryText: string, values: unknown[]): Promise<QueryResult | null> {
  const activePool = getPool();
  if (!activePool) {
    return null;
  }
  return activePool.query(queryText, values);
}

export async function bumpCompanyDocumentsVersion(companyId: string | number): Promise<void> {
  if (!isSqlCompanySyncStoreEnabled()) return;

  await runQuery(
    `
      INSERT INTO company_sync_state (
        company_id,
        jobs_version,
        documents_version,
        clients_version,
        workers_version,
        company_inventory_version,
        updated_at
      )
      SELECT id, 0, 1, 0, 0, 0, NOW()
      FROM companies
      WHERE public_company_id = $1
      ON CONFLICT (company_id)
      DO UPDATE SET
        documents_version = company_sync_state.documents_version + 1,
        updated_at = NOW()
    `,
    [Number(companyId)],
  );
}