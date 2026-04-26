import { type PoolClient } from 'pg';
import {
  connectSharedSqlClient,
  isSharedSqlStoreEnabled,
  runSharedSqlQuery,
} from './sql-store';

type ClaimResult = {
  shouldProcess: boolean;
  reason: string | null;
};

type TaskCompletionOptions = {
  taskType?: 'preview' | 'generate' | string | null;
  resultUrl?: string | null;
  storagePath?: string | null;
  pdfSize?: number | null;
  publicDocumentId?: string | null;
};

export function isSqlTaskStoreEnabled(): boolean {
  return isSharedSqlStoreEnabled();
}

export async function claimTaskProcessing(taskId: string, options: { staleAfterMs?: number } = {}): Promise<ClaimResult> {
  if (!isSqlTaskStoreEnabled()) {
    return { shouldProcess: true, reason: null };
  }

  const staleAfterMs = Math.max(1_000, Number(options.staleAfterMs || 15 * 60 * 1000) || 15 * 60 * 1000);
  const client = await connectSharedSqlClient() as PoolClient;

  try {
    await client.query('BEGIN');
    const current = await client.query(
      `
        SELECT status, processing_started_at
        FROM document_tasks
        WHERE task_key = $1
        LIMIT 1
        FOR UPDATE
      `,
      [String(taskId || '').trim()],
    );

    const row: any = current.rows?.[0] || null;
    if (!row) {
      await client.query('COMMIT');
      return { shouldProcess: false, reason: 'task_not_found' };
    }

    const status = String(row.status || '').trim();
    const processingStartedAt = row.processing_started_at ? new Date(row.processing_started_at) : null;
    if (status === 'completed' || status === 'failed') {
      await client.query('COMMIT');
      return { shouldProcess: false, reason: `already_${status}` };
    }
    if (status === 'processing') {
      const processingStartedMs = processingStartedAt instanceof Date && !Number.isNaN(processingStartedAt.getTime())
        ? processingStartedAt.getTime()
        : 0;
      if (processingStartedMs && Date.now() - processingStartedMs < staleAfterMs) {
        await client.query('COMMIT');
        return { shouldProcess: false, reason: 'already_processing' };
      }
    } else if (status !== 'queued' && status !== 'pending') {
      await client.query('COMMIT');
      return { shouldProcess: false, reason: `invalid_state_${status || 'unknown'}` };
    }

    await client.query(
      `
        UPDATE document_tasks
        SET status = 'processing',
            processing_started_at = NOW(),
            error = NULL
        WHERE task_key = $1
      `,
      [String(taskId || '').trim()],
    );

    await client.query('COMMIT');
    return { shouldProcess: true, reason: null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markTaskProcessing(taskId: string): Promise<void> {
  if (!isSqlTaskStoreEnabled()) return;

  await runSharedSqlQuery(
    `
      UPDATE document_tasks
      SET status = 'processing',
          processing_started_at = NOW()
      WHERE task_key = $1
    `,
    [String(taskId || '').trim()],
  );
}

export async function markTaskCompleted(taskId: string, options: TaskCompletionOptions = {}): Promise<void> {
  if (!isSqlTaskStoreEnabled()) return;

  const payloadPatch: Record<string, unknown> = {};
  if (options.taskType === 'preview' && options.resultUrl) {
    payloadPatch.previewURL = options.resultUrl;
  }
  if (options.taskType === 'generate' && options.resultUrl) {
    payloadPatch.downloadURL = options.resultUrl;
  }
  if (options.publicDocumentId) {
    payloadPatch.publicDocumentId = options.publicDocumentId;
  }

  const previewUrl = options.taskType === 'preview' ? options.resultUrl || null : null;
  const generateUrl = options.taskType === 'generate' ? options.resultUrl || null : null;

  await runSharedSqlQuery(
    `
      UPDATE document_tasks
      SET status = 'completed',
          preview_url = $2,
          generate_url = $3,
          storage_path = $4,
          pdf_size = $5,
          error = NULL,
          completed_at = NOW(),
          request_payload = COALESCE(request_payload, '{}'::jsonb) || $6::jsonb
      WHERE task_key = $1
    `,
    [
      String(taskId || '').trim(),
      previewUrl,
      generateUrl,
      options.storagePath || null,
      options.pdfSize ?? null,
      JSON.stringify(payloadPatch),
    ],
  );
}

export async function markTaskFailed(taskId: string, errorMessage?: string): Promise<void> {
  if (!isSqlTaskStoreEnabled()) return;

  await runSharedSqlQuery(
    `
      UPDATE document_tasks
      SET status = 'failed',
          error = $2,
          completed_at = NOW()
      WHERE task_key = $1
    `,
    [String(taskId || '').trim(), String(errorMessage || 'Task failed')],
  );
}