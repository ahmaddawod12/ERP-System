import {
  JobAttachmentUploadSessionSchema,
  JobCompletionRequestSchema,
  JobCompletionResultSchema,
  JobCreateRequestSchema,
  JobCreateResultSchema,
  type JobAttachmentUploadSession,
} from '@smart-job/api-contracts';

import {
  ApiClientError,
  AUTH_IDENTITY_CHANGED_CODE,
  requestApi,
} from '../api/client';
import { restoreSupabaseSession } from '../auth/supabase-client';
import {
  deleteStagedAttachment,
  deleteStagedAttachmentDirectory,
} from './attachments';
import {
  UserOutboxDatabase,
  type OutboxAttachmentRecord,
  type OutboxOperation,
} from './database';
import { classifyOutboxFailure, retryDelayMs } from './policy';
import {
  outcomeForOutboxStatus,
  type OutboxOperationResult,
  type OutboxSynchronizationResult,
} from './outcomes';
import { uploadEncryptedAttachment } from './upload';

export {
  outcomeForOutboxStatus,
  type OutboxOperationOutcome,
  type OutboxOperationResult,
  type OutboxSynchronizationResult,
} from './outcomes';

const UPLOAD_SESSION_PAYLOAD_KEY = '_uploadSession';

export interface OutboxTransport {
  execute(
    operation: OutboxOperation,
    attachments: readonly OutboxAttachmentRecord[],
    database: UserOutboxDatabase,
  ): Promise<void>;
}

function invalidPayload(cause?: unknown): ApiClientError {
  return new ApiClientError(
    cause instanceof Error ? cause.message : 'The queued job payload is invalid',
    400,
    'OUTBOX_PAYLOAD_INVALID',
    false,
  );
}

function uploadSessionCanBeReused(
  candidate: unknown,
  operation: OutboxOperation,
  attachments: readonly OutboxAttachmentRecord[],
): JobAttachmentUploadSession | null {
  const parsed = JobAttachmentUploadSessionSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const session = parsed.data;
  if (
    session.companyId !== operation.companyId
    || new Date(session.expiresAt).getTime() <= Date.now() + 60_000
  ) {
    return null;
  }
  const expectedJobId = operation.kind === 'job.complete_assigned'
    ? String(operation.payload.jobId || '')
    : null;
  if (session.jobId !== expectedJobId) return null;
  const targetIds = new Set(session.attachments.map((target) => target.attachmentId));
  return attachments.length === targetIds.size
    && attachments.every((attachment) => targetIds.has(attachment.id))
    ? session
    : null;
}

async function ensureUploadSession(
  operation: OutboxOperation,
  attachments: readonly OutboxAttachmentRecord[],
  database: UserOutboxDatabase,
): Promise<JobAttachmentUploadSession | null> {
  if (attachments.length === 0) return null;

  let session = uploadSessionCanBeReused(
    operation.payload[UPLOAD_SESSION_PAYLOAD_KEY],
    operation,
    attachments,
  );
  if (!session) {
    const jobId = operation.kind === 'job.complete_assigned'
      ? String(operation.payload.jobId || '')
      : null;
    if (operation.kind === 'job.complete_assigned' && !jobId) {
      throw invalidPayload();
    }
    session = await requestApi(
      '/api/v1/uploads/job-attachments/sessions',
      JobAttachmentUploadSessionSchema,
      {
        method: 'POST',
        body: {
          companyId: operation.companyId,
          purpose: operation.kind,
          jobId,
          attachments: attachments.map((attachment) => ({
            attachmentId: attachment.id,
            kind: attachment.kind,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sha256: attachment.sha256,
          })),
        },
        uid: operation.userId,
        companyId: operation.companyId,
      },
    );
    await database.updatePayload(operation.id, {
      ...operation.payload,
      [UPLOAD_SESSION_PAYLOAD_KEY]: session,
    });
  }

  for (const attachment of attachments) {
    const target = session.attachments.find(
      (candidate) => candidate.attachmentId === attachment.id,
    );
    if (!target) throw invalidPayload();
    await uploadEncryptedAttachment(operation.userId, attachment, target);
  }
  return session;
}

function publicPayload(operation: OutboxOperation): Record<string, unknown> {
  const {
    [UPLOAD_SESSION_PAYLOAD_KEY]: _uploadSession,
    ...payload
  } = operation.payload;
  return payload;
}

export const apiOutboxTransport: OutboxTransport = {
  async execute(operation, attachments, database): Promise<void> {
    const uploadSession = await ensureUploadSession(operation, attachments, database);
    const payload = publicPayload(operation);

    try {
      if (operation.kind === 'job.create_finished') {
        const body = JobCreateRequestSchema.parse({
          ...payload,
          status: 'finished',
          uploadSessionId: uploadSession?.uploadSessionId ?? null,
        });
        await requestApi(
          `/api/v1/companies/${operation.companyId}/jobs`,
          JobCreateResultSchema,
          {
            method: 'POST',
            body,
            idempotencyKey: operation.idempotencyKey,
            uid: operation.userId,
            companyId: operation.companyId,
          },
        );
        return;
      }

      const jobId = String(payload.jobId || '').trim();
      if (!jobId || !operation.entityVersion) {
        throw invalidPayload();
      }
      const { jobId: _jobId, ...completionPayload } = payload;
      const body = JobCompletionRequestSchema.parse({
        ...completionPayload,
        entityVersion: operation.entityVersion,
        uploadSessionId: uploadSession?.uploadSessionId ?? null,
      });
      await requestApi(
        `/api/v1/companies/${operation.companyId}/jobs/${jobId}/complete`,
        JobCompletionResultSchema,
        {
          method: 'POST',
          body,
          idempotencyKey: operation.idempotencyKey,
          uid: operation.userId,
          companyId: operation.companyId,
        },
      );
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      throw invalidPayload(error);
    }
  },
};

const activeSynchronizations = new WeakMap<
  UserOutboxDatabase,
  Promise<OutboxSynchronizationResult>
>();

export function waitForActiveOutboxSynchronization(
  database: UserOutboxDatabase,
): Promise<OutboxSynchronizationResult> {
  return activeSynchronizations.get(database) ?? Promise.resolve({ operations: [] });
}

async function currentUserMatches(database: UserOutboxDatabase): Promise<boolean> {
  const session = await restoreSupabaseSession();
  return session?.user.id.toLowerCase() === database.userId;
}

async function drainFileCleanup(database: UserOutboxDatabase): Promise<void> {
  const pending = await database.pendingFileCleanup();
  for (const cleanup of pending) {
    try {
      deleteStagedAttachmentDirectory(cleanup.stagedDirectoryUri);
      await database.acknowledgeFileCleanup(cleanup.id);
    } catch {
      // The tombstone remains for the next foreground synchronization.
    }
  }
}

export function synchronizeOutbox(
  database: UserOutboxDatabase,
  transport: OutboxTransport = apiOutboxTransport,
): Promise<OutboxSynchronizationResult> {
  const activeSynchronization = activeSynchronizations.get(database);
  if (activeSynchronization) {
    return activeSynchronization;
  }

  const synchronization = (async (): Promise<OutboxSynchronizationResult> => {
    const operations: OutboxOperationResult[] = [];
    const result = (): OutboxSynchronizationResult => ({ operations });
    if (!(await currentUserMatches(database))) return result();
    await drainFileCleanup(database);
    await database.resumeAfterAuthentication();
    for (let processed = 0; processed < 20; processed += 1) {
      if (!(await currentUserMatches(database))) return result();
      const operation = await database.claimNext();
      if (!operation) return result();
      if (!(await currentUserMatches(database))) {
        await database.releaseClaim(operation.id);
        operations.push({ operationId: operation.id, outcome: 'queued' });
        return result();
      }
      const attachments = await database.attachments(operation.id);
      try {
        await transport.execute(operation, attachments, database);
        const completedAttachments = await database.complete(operation.id);
        operations.push({ operationId: operation.id, outcome: 'reconciled' });
        for (const attachment of completedAttachments) {
          try {
            deleteStagedAttachment(attachment);
            await database.acknowledgeFileCleanup(attachment.id);
          } catch {
            // Cleanup remains durable and is retried on the next trigger.
          }
        }
      } catch (cause: unknown) {
        const error = cause instanceof ApiClientError
          ? cause
          : new ApiClientError('Outbox synchronization failed', 0, 'NETWORK_ERROR', true);
        if (error.code === AUTH_IDENTITY_CHANGED_CODE) {
          await database.releaseClaim(operation.id);
          operations.push({
            operationId: operation.id,
            outcome: 'queued',
            errorCode: error.code,
            errorMessage: error.message,
          });
          return result();
        }
        const disposition = classifyOutboxFailure(error);
        if (disposition === 'pause-auth') {
          await database.markFailure({
            operationId: operation.id,
            status: 'paused_auth',
            code: error.code,
            message: error.message,
          });
          operations.push({
            operationId: operation.id,
            outcome: 'queued',
            errorCode: error.code,
            errorMessage: error.message,
          });
          return result();
        }
        if (disposition === 'conflict') {
          await database.markFailure({
            operationId: operation.id,
            status: 'conflict',
            code: error.code,
            message: error.message,
          });
          operations.push({
            operationId: operation.id,
            outcome: 'conflict',
            errorCode: error.code,
            errorMessage: error.message,
          });
          continue;
        }
        if (disposition === 'terminal') {
          await database.markFailure({
            operationId: operation.id,
            status: 'terminal_error',
            code: error.code,
            message: error.message,
          });
          operations.push({
            operationId: operation.id,
            outcome: 'terminal',
            errorCode: error.code,
            errorMessage: error.message,
          });
          continue;
        }
        await database.markFailure({
          operationId: operation.id,
          status: 'retry_wait',
          code: error.code,
          message: error.message,
          nextRetryAt: Date.now() + retryDelayMs(operation.attempts),
        });
        operations.push({
          operationId: operation.id,
          outcome: 'retry',
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
    }
    return result();
  })().finally(() => {
    activeSynchronizations.delete(database);
  });
  activeSynchronizations.set(database, synchronization);
  return synchronization;
}
