import { getDb } from './client';
import { documentTasks } from './schema';
import { resolveCompanyByPublicId } from './membership';

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function asTrimmedTaskId(value) {
  return String(value || '').trim();
}

function isActiveTaskConstraintError(error) {
  const constraintName = String(error?.constraint || error?.constraint_name || '').trim();
  return error?.code === '23505' && constraintName === 'document_tasks_active_company_type_unique';
}

function createActiveTaskConflictError(input) {
  const taskLabel = String(input?.taskType || 'document').trim() || 'document';
  const error = new Error(`Another ${taskLabel} task is already in progress for this document type. Please wait a few seconds and try again.`);
  (error as any).code = 'failed-precondition';
  return error;
}

function buildTaskPayloadPatch(options: any = {}) {
  const patch: Record<string, any> = {};
  if (options.taskType === 'preview' && options.resultUrl) {
    patch.previewURL = options.resultUrl;
  }
  if (options.taskType === 'generate' && options.resultUrl) {
    patch.downloadURL = options.resultUrl;
  }
  if (options.publicDocumentId) {
    patch.publicDocumentId = options.publicDocumentId;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'emailSent')) {
    patch.emailSent = Boolean(options.emailSent);
  }
  if (options.emailMessageId) {
    patch.emailMessageId = options.emailMessageId;
  }
  if (options.emailError) {
    patch.emailError = options.emailError;
  }
  if (options.emailRecipient) {
    patch.emailRecipient = options.emailRecipient;
  }
  if (options.pubsubMessageId) {
    patch.pubsubMessageId = options.pubsubMessageId;
  }
  return patch;
}

async function createDocumentTask(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const expireAt = asDate(input.expireAt, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));

  try {
    return await db.transaction(async (tx) => {
      const company = await resolveCompanyByPublicId(tx, input.companyId);
      if (!company) {
        const error = new Error('Company not found');
        (error as any).code = 'not-found';
        throw error;
      }

      await tx.insert(documentTasks).values({
        taskKey: asTrimmedTaskId(input.taskId),
        companyId: company.id,
        userId: String(input.uid || '').trim(),
        documentId: null,
        taskType: input.taskType,
        documentType: Number(input.documentType),
        status: input.status || 'pending',
        requestPayload: input.requestPayload && typeof input.requestPayload === 'object' ? input.requestPayload : {},
        expireAt,
        createdAt: now,
      });

      return {
        taskId: asTrimmedTaskId(input.taskId),
        companyId: String(input.companyId || '').trim(),
      };
    });
  } catch (error) {
    if (isActiveTaskConstraintError(error)) {
      throw createActiveTaskConflictError(input);
    }
    throw error;
  }
}

async function markDocumentTaskQueued(taskId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const payloadPatch = buildTaskPayloadPatch({
    ...options,
    pubsubMessageId: options.pubsubMessageId || null,
  });
  const patchJson = JSON.stringify(payloadPatch);

  await db.execute(require('drizzle-orm').sql`
    UPDATE document_tasks
    SET status = 'queued',
        request_payload = COALESCE(request_payload, '{}'::jsonb) || ${patchJson}::jsonb
    WHERE task_key = ${asTrimmedTaskId(taskId)}
  `);
}

async function claimDocumentTaskForProcessing(taskId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const staleAfterMs = Math.max(1_000, Number(options.staleAfterMs || 15 * 60 * 1000) || 15 * 60 * 1000);

  return db.transaction(async (tx) => {
    const result = await tx.execute(require('drizzle-orm').sql`
      SELECT status, processing_started_at
      FROM document_tasks
      WHERE task_key = ${asTrimmedTaskId(taskId)}
      LIMIT 1
      FOR UPDATE
    `);

    const row = result.rows?.[0] || null;
    if (!row) {
      return { shouldProcess: false, reason: 'task_not_found' };
    }

    const status = String(row.status || '').trim();
    const processingStartedAt = row.processing_started_at ? new Date(row.processing_started_at) : null;
    if (status === 'completed' || status === 'failed') {
      return { shouldProcess: false, reason: `already_${status}` };
    }
    if (status === 'processing') {
      const processingStartedMs = processingStartedAt instanceof Date && !Number.isNaN(processingStartedAt.getTime())
        ? processingStartedAt.getTime()
        : 0;
      if (processingStartedMs && Date.now() - processingStartedMs < staleAfterMs) {
        return { shouldProcess: false, reason: 'already_processing' };
      }
    } else if (status !== 'queued' && status !== 'pending') {
      return { shouldProcess: false, reason: `invalid_state_${status || 'unknown'}` };
    }

    await tx.execute(require('drizzle-orm').sql`
      UPDATE document_tasks
      SET status = 'processing',
          processing_started_at = NOW(),
          error = NULL
      WHERE task_key = ${asTrimmedTaskId(taskId)}
    `);

    return { shouldProcess: true, reason: null };
  });
}

async function markDocumentTaskCompleted(taskId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const payloadPatch = buildTaskPayloadPatch(options);
  const patchJson = JSON.stringify(payloadPatch);

  await db.execute(require('drizzle-orm').sql`
    UPDATE document_tasks
    SET status = 'completed',
        preview_url = ${options.taskType === 'preview' ? options.resultUrl || null : null},
        storage_path = ${options.storagePath || null},
        pdf_size = ${options.pdfSize ?? null},
        error = NULL,
        completed_at = NOW(),
        request_payload = COALESCE(request_payload, '{}'::jsonb) || ${patchJson}::jsonb
    WHERE task_key = ${asTrimmedTaskId(taskId)}
  `);
}

async function markDocumentTaskFailed(taskId, errorMessage, options: any = {}) {
  const db = options.db || getDb(options.env);

  await db.execute(require('drizzle-orm').sql`
    UPDATE document_tasks
    SET status = 'failed',
        error = ${String(errorMessage || 'Task failed')},
        completed_at = NOW()
    WHERE task_key = ${asTrimmedTaskId(taskId)}
  `);
}

export { claimDocumentTaskForProcessing, createDocumentTask, markDocumentTaskCompleted, markDocumentTaskFailed, markDocumentTaskQueued };

