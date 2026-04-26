import { isSharedSqlStoreEnabled, runSharedSqlQuery } from './sql-store';

type DocumentGenerationInput = {
  companyId: string | number;
  documentId: string;
  storagePath: string;
};

type DocumentGenerationFailureInput = {
  companyId: string | number;
  documentId: string;
  errorMessage?: string;
};

export function isSqlDocumentStoreEnabled(): boolean {
  return isSharedSqlStoreEnabled();
}

export async function completeDocumentGeneration({ companyId, documentId, storagePath }: DocumentGenerationInput): Promise<void> {
  if (!isSqlDocumentStoreEnabled()) return;

  const result = await runSharedSqlQuery(
    `
      UPDATE documents AS d
      SET storage_path = $3,
          generation_status = 'completed',
          updated_at = NOW()
      FROM companies AS c
      WHERE d.company_id = c.id
        AND c.public_company_id = $1
        AND d.document_code = $2
    `,
    [Number(companyId), String(documentId || '').trim(), String(storagePath || '').trim()],
  );

  if (!result || result.rowCount < 1) {
    throw new Error('Document row not found in SQL');
  }
}

export async function failDocumentGeneration({ companyId, documentId, errorMessage }: DocumentGenerationFailureInput): Promise<void> {
  if (!isSqlDocumentStoreEnabled()) return;

  await runSharedSqlQuery(
    `
      UPDATE documents AS d
      SET generation_status = 'failed',
          updated_at = NOW(),
          payload = COALESCE(d.payload, '{}'::jsonb) || jsonb_build_object('generationError', $3)
      FROM companies AS c
      WHERE d.company_id = c.id
        AND c.public_company_id = $1
        AND d.document_code = $2
    `,
    [Number(companyId), String(documentId || '').trim(), String(errorMessage || 'Generation failed')],
  );
}