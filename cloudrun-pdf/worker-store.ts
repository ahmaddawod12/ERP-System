import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';

import { runSharedSqlQuery } from './sql-store';

export type CanonicalPdfTask = {
  leaseToken: string;
  taskId: string;
  taskType: 'preview' | 'generate';
  internalCompanyId: string;
  publicCompanyId: string;
  userId: string;
  internalDocumentId: string | null;
  documentCode: string | null;
  documentNumber: number | null;
  documentType: number;
  documentData: Record<string, unknown>;
  confirmationNumber: string | null;
  processingAttempt: number;
};

interface CanonicalPdfTaskRow extends QueryResultRow {
  task_key: unknown;
  task_type: unknown;
  internal_company_id: unknown;
  public_company_id: unknown;
  user_id: unknown;
  internal_document_id: unknown;
  document_code: unknown;
  document_number: unknown;
  document_type: unknown;
  document_data: unknown;
  confirmation_number: unknown;
  processing_attempt: unknown;
}

interface PdfCompletionRow extends QueryResultRow {
  completed: unknown;
  delivery_id: unknown;
}

interface PdfFailureRow extends QueryResultRow {
  persisted: unknown;
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${field} is missing from the canonical PDF task`);
  return normalized;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${field} is invalid in the canonical PDF task`);
  }
  return parsed;
}

export async function claimPdfDocumentTask(
  taskId: string,
  leaseSeconds = 300,
): Promise<CanonicalPdfTask | null> {
  const leaseToken = randomUUID();
  const result = await runSharedSqlQuery<CanonicalPdfTaskRow>(
    `SELECT * FROM private.claim_pdf_document_task($1::text, $2::uuid, $3::integer)`,
    [requiredText(taskId, 'taskId'), leaseToken, leaseSeconds],
  );
  const row = result?.rows?.[0] ?? null;
  if (!row) return null;
  if (!row.document_data || typeof row.document_data !== 'object' || Array.isArray(row.document_data)) {
    throw new TypeError('documentData is invalid in the canonical PDF task');
  }
  const taskType = requiredText(row.task_type, 'taskType');
  if (taskType !== 'preview' && taskType !== 'generate') {
    throw new TypeError('taskType is invalid in the canonical PDF task');
  }
  const documentNumber = row.document_number === null
    ? null
    : positiveInteger(row.document_number, 'documentNumber');
  return {
    leaseToken,
    taskId: requiredText(row.task_key, 'taskId'),
    taskType,
    internalCompanyId: requiredText(row.internal_company_id, 'internalCompanyId'),
    publicCompanyId: requiredText(row.public_company_id, 'publicCompanyId'),
    userId: requiredText(row.user_id, 'userId'),
    internalDocumentId: nullableText(row.internal_document_id),
    documentCode: nullableText(row.document_code),
    documentNumber,
    documentType: positiveInteger(row.document_type, 'documentType'),
    documentData: row.document_data as Record<string, unknown>,
    confirmationNumber: nullableText(row.confirmation_number),
    processingAttempt: positiveInteger(row.processing_attempt, 'processingAttempt'),
  };
}

export async function completePdfDocumentTask(
  task: CanonicalPdfTask,
  storagePath: string,
  pdfSize: number,
): Promise<{ completed: boolean; deliveryId: string | null }> {
  const result = await runSharedSqlQuery<PdfCompletionRow>(
    `SELECT * FROM private.complete_pdf_document_task(
       $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::integer,
       clock_timestamp()
     )`,
    [
      task.taskId,
      task.leaseToken,
      task.internalCompanyId,
      task.internalDocumentId,
      storagePath,
      pdfSize,
    ],
  );
  const row = result?.rows?.[0] ?? null;
  if (!row || row.completed !== true) {
    throw new Error('PDF task completion was rejected by the canonical lease');
  }
  return {
    completed: true,
    deliveryId: nullableText(row.delivery_id),
  };
}

export async function failPdfDocumentTask(
  task: CanonicalPdfTask,
  error: unknown,
  retryable: boolean,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : 'PDF processing failed';
  const result = await runSharedSqlQuery<PdfFailureRow>(
    `SELECT private.fail_pdf_document_task(
       $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::boolean,
       $7::integer
     ) AS persisted`,
    [
      task.taskId,
      task.leaseToken,
      task.internalCompanyId,
      task.internalDocumentId,
      message.slice(0, 2_000),
      retryable,
      30,
    ],
  );
  return result?.rows?.[0]?.persisted === true;
}
