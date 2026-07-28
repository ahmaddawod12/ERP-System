import {
  JobCompletionRequestSchema,
  JobCreateRequestSchema,
  JobSummarySchema,
  type UploadAttachmentManifest,
} from '@smart-job/api-contracts';

import type { JobFileRef } from '../../../types';
import {
  jobAttachmentExtension,
  type JobAttachmentMimeType,
} from '../../../lib/outbox/image-content.ts';

type AttachmentMimeType = UploadAttachmentManifest['mimeType'];

export interface FinishedJobPartInput {
  readonly id?: string | number;
  readonly partId?: string | number;
  readonly quantity?: string | number;
  readonly usedQuantity?: string | number;
}

export interface FinishedJobPayloadInput {
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly clientId?: string | number | null;
  readonly assigneeMemberNo?: string | number | null;
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly signingPerson: string;
  readonly travelDistance?: string | number | null;
  readonly parts: readonly FinishedJobPartInput[];
}

export interface AssignedJobCompletionPayloadInput {
  readonly jobId: string;
  readonly entityVersion: string;
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly signingPerson: string;
  readonly travelDistance?: string | number | null;
  readonly parts: readonly FinishedJobPartInput[];
}

export interface LocalFinishedJobAttachment {
  readonly sourceUri: string;
  readonly kind: 'photo' | 'signature';
  readonly fileName: string;
  readonly mimeType: AttachmentMimeType;
}

const DATA_IMAGE_PATTERN = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,/i;
const LOCAL_URI_PATTERN = /^(?:file|content|ph|asset-library):/i;

function nullableTrimmed(value: string | number | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

function mapPart(part: FinishedJobPartInput) {
  return {
    partId: Number(part.partId ?? part.id),
    quantity: Number(part.usedQuantity ?? part.quantity),
  };
}

export function buildFinishedJobOutboxPayload(input: FinishedJobPayloadInput) {
  return JobCreateRequestSchema.parse({
    title: input.title,
    description: input.description,
    location: nullableTrimmed(input.location),
    clientId: nullableTrimmed(input.clientId),
    assigneeMemberNo: nullableNumber(input.assigneeMemberNo),
    status: 'finished',
    timeFrom: input.timeFrom,
    timeTo: input.timeTo,
    signingPerson: nullableTrimmed(input.signingPerson),
    travelDistance: nullableNumber(input.travelDistance),
    partsUsed: input.parts.map(mapPart),
  });
}

export function buildAssignedJobCompletionOutboxPayload(
  input: AssignedJobCompletionPayloadInput,
) {
  const parsed = JobCompletionRequestSchema.parse({
    entityVersion: input.entityVersion,
    timeFrom: input.timeFrom,
    timeTo: input.timeTo,
    signingPerson: nullableTrimmed(input.signingPerson),
    travelDistance: nullableNumber(input.travelDistance),
    partsUsed: input.parts.map(mapPart),
  });
  const { entityVersion: _entityVersion, ...details } = parsed;
  return {
    jobId: JobSummarySchema.shape.jobId.parse(input.jobId),
    ...details,
  };
}

function localUri(file: string | JobFileRef): string {
  const candidate = typeof file === 'string' ? file : file.uri;
  const normalized = String(candidate ?? '').trim();
  if (DATA_IMAGE_PATTERN.test(normalized) || LOCAL_URI_PATTERN.test(normalized)) {
    return normalized;
  }
  throw new Error('Finished-job attachments must be available on this device');
}

export const getLocalFinishedJobAttachmentUri = localUri;

export function describeFinishedJobAttachment(
  file: string | JobFileRef,
  kind: 'photo' | 'signature',
  mimeType: JobAttachmentMimeType,
  index = 0,
): LocalFinishedJobAttachment {
  const sourceUri = getLocalFinishedJobAttachmentUri(file);
  const extension = jobAttachmentExtension(mimeType);
  return {
    sourceUri,
    kind,
    fileName: kind === 'signature'
      ? `signature.${extension}`
      : `photo-${String(index + 1).padStart(2, '0')}.${extension}`,
    mimeType,
  };
}
