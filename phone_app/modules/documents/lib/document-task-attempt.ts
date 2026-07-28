import {
  DocumentTaskAcceptedSchema,
  type DocumentTaskAccepted,
} from '@smart-job/api-contracts';
import { z } from 'zod';

export type DocumentTaskAction = 'preview' | 'generate';

export const PersistedDocumentTaskAttemptSchema = z.object({
  version: z.literal(1),
  uid: z.uuid(),
  companyId: z.number().int().positive(),
  action: z.enum(['preview', 'generate']),
  fingerprint: z.string().min(1),
  idempotencyKey: z.string().trim().min(8).max(128),
  accepted: DocumentTaskAcceptedSchema.nullable(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type PersistedDocumentTaskAttempt = z.infer<typeof PersistedDocumentTaskAttemptSchema>;

export function buildDocumentTaskAttempt(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly action: DocumentTaskAction;
  readonly fingerprint: string;
  readonly idempotencyKey: string;
  readonly accepted?: DocumentTaskAccepted | null;
  readonly updatedAt?: number;
}): PersistedDocumentTaskAttempt {
  return PersistedDocumentTaskAttemptSchema.parse({
    version: 1,
    uid: input.uid,
    companyId: input.companyId,
    action: input.action,
    fingerprint: input.fingerprint,
    idempotencyKey: input.idempotencyKey,
    accepted: input.accepted ?? null,
    updatedAt: input.updatedAt ?? Date.now(),
  });
}
