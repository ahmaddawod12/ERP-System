import { isSharedSqlStoreEnabled, runSharedSqlQuery } from './sql-store';

export function isSqlCompanySyncStoreEnabled(): boolean {
  return isSharedSqlStoreEnabled();
}

export async function bumpCompanyDocumentsVersion(companyId: string | number): Promise<void> {
  if (!isSqlCompanySyncStoreEnabled()) return;

  await runSharedSqlQuery(
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