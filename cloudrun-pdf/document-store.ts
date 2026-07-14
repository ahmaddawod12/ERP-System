import { type PoolClient } from 'pg';

import {
  connectSharedSqlClient,
  isSharedSqlStoreEnabled,
  runSharedSqlQuery,
} from './sql-store';

export type CompanyStorageContext = {
  internalCompanyId: string;
};

export type DocumentStorageContext = CompanyStorageContext & {
  internalDocumentId: string;
  documentCode: string;
};

type DocumentGenerationInput = {
  internalCompanyId: string;
  internalDocumentId: string;
  storagePath: string;
  documentType?: number | null;
};

type DocumentGenerationFailureInput = {
  internalCompanyId: string;
  internalDocumentId: string;
  errorMessage?: string;
};

function publicCompanyNumber(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError('companyId must be a positive public company number');
  }
  return parsed;
}

function normalizedDocumentCode(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 64) {
    throw new TypeError('documentId must contain between 1 and 64 characters');
  }
  return normalized;
}

function documentFinalizationConflict(): Error {
  const error: any = new Error('Document row is missing or already points to a different generated file');
  error.code = 'document_finalization_conflict';
  error.retryable = false;
  return error;
}

export function isSqlDocumentStoreEnabled(): boolean {
  return isSharedSqlStoreEnabled();
}

export async function resolveCompanyStorageContext(
  companyId: string | number,
): Promise<CompanyStorageContext> {
  const result = await runSharedSqlQuery(
    `
      SELECT company.id::text AS internal_company_id
      FROM companies AS company
      WHERE company.public_company_id = $1
        AND company.status = 'active'
      LIMIT 1
    `,
    [publicCompanyNumber(companyId)],
  );
  const row: any = result?.rows?.[0] || null;
  if (!row?.internal_company_id) {
    throw documentFinalizationConflict();
  }
  return { internalCompanyId: String(row.internal_company_id) };
}

export async function resolveDocumentStorageContext(
  companyId: string | number,
  documentId: unknown,
  documentType?: number | null,
): Promise<DocumentStorageContext> {
  const normalizedType = Number(documentType || 0) || null;
  const result = await runSharedSqlQuery(
    `
      SELECT
        company.id::text AS internal_company_id,
        document.id::text AS internal_document_id,
        document.document_code
      FROM documents AS document
      INNER JOIN companies AS company ON company.id = document.company_id
      WHERE company.public_company_id = $1
        AND company.status = 'active'
        AND document.document_code = $2
        AND ($3::integer IS NULL OR document.document_type = $3)
      LIMIT 1
    `,
    [publicCompanyNumber(companyId), normalizedDocumentCode(documentId), normalizedType],
  );
  const row: any = result?.rows?.[0] || null;
  if (!row?.internal_company_id || !row?.internal_document_id || !row?.document_code) {
    throw documentFinalizationConflict();
  }
  return {
    internalCompanyId: String(row.internal_company_id),
    internalDocumentId: String(row.internal_document_id),
    documentCode: String(row.document_code),
  };
}

export async function completeDocumentGeneration({
  internalCompanyId,
  internalDocumentId,
  storagePath,
  documentType,
}: DocumentGenerationInput): Promise<{ finalized: boolean }> {
  if (!isSqlDocumentStoreEnabled()) {
    throw new Error('SQL document store is required');
  }

  const normalizedType = Number(documentType || 0) || null;
  const normalizedPath = String(storagePath || '').trim();
  const client = await connectSharedSqlClient() as PoolClient;
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `
        SELECT storage_path, generation_status
        FROM documents
        WHERE company_id = $1::uuid
          AND id = $2::uuid
          AND ($3::integer IS NULL OR document_type = $3)
        LIMIT 1
        FOR UPDATE
      `,
      [internalCompanyId, internalDocumentId, normalizedType],
    );
    const row: any = current.rows?.[0] || null;
    if (!row) {
      throw documentFinalizationConflict();
    }

    if (row.storage_path === null) {
      await client.query(
        `
          UPDATE documents
          SET storage_path = $3,
              generation_status = 'completed',
              updated_at = NOW()
          WHERE company_id = $1::uuid
            AND id = $2::uuid
            AND storage_path IS NULL
        `,
        [internalCompanyId, internalDocumentId, normalizedPath],
      );
      const sync = await client.query(
        `
          UPDATE company_sync_state
          SET documents_version = documents_version + 1,
              updated_at = NOW()
          WHERE company_id = $1::uuid
          RETURNING company_id
        `,
        [internalCompanyId],
      );
      if (sync.rowCount !== 1) {
        throw new Error('Company sync state is missing for document finalization');
      }
      await client.query('COMMIT');
      return { finalized: true };
    }

    if (String(row.storage_path) === normalizedPath && String(row.generation_status) === 'completed') {
      await client.query('COMMIT');
      return { finalized: false };
    }

    throw documentFinalizationConflict();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function failDocumentGeneration({
  internalCompanyId,
  internalDocumentId,
  errorMessage,
}: DocumentGenerationFailureInput): Promise<void> {
  if (!isSqlDocumentStoreEnabled()) return;

  await runSharedSqlQuery(
    `
      UPDATE documents
      SET generation_status = 'failed',
          updated_at = NOW(),
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('generationError', $3)
      WHERE company_id = $1::uuid
        AND id = $2::uuid
        AND storage_path IS NULL
        AND generation_status <> 'completed'
    `,
    [internalCompanyId, internalDocumentId, String(errorMessage || 'Generation failed')],
  );
}
