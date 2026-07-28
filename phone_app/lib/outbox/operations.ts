import { deleteStagedAttachment } from './attachments';
import {
  UserOutboxDatabase,
  type OutboxAttachmentRecord,
  type OutboxOperationKind,
} from './database';

export async function enqueueOutboxOperation(input: {
  readonly database: UserOutboxDatabase;
  readonly companyId: number;
  readonly kind: OutboxOperationKind;
  readonly payload: Record<string, unknown>;
  readonly entityVersion?: string | null;
  readonly attachments?: readonly Omit<OutboxAttachmentRecord, 'operationId'>[];
}): Promise<string> {
  try {
    return await input.database.enqueue({
      companyId: input.companyId,
      kind: input.kind,
      payload: input.payload,
      entityVersion: input.entityVersion,
      attachments: input.attachments,
    });
  } catch (error) {
    for (const attachment of input.attachments ?? []) {
      deleteStagedAttachment({ ...attachment, operationId: '' });
    }
    throw error;
  }
}

export async function discardOutboxOperation(
  database: UserOutboxDatabase,
  operationId: string,
): Promise<void> {
  const attachments = await database.discard(operationId);
  for (const attachment of attachments) {
    deleteStagedAttachment(attachment);
    await database.acknowledgeFileCleanup(attachment.id);
  }
}
