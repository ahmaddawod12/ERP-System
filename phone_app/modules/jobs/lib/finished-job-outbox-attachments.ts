import { File, FileMode } from 'expo-file-system';
import {
  MAX_JOB_ATTACHMENT_BYTES,
  MAX_JOB_ATTACHMENT_TOTAL_BYTES,
} from '@smart-job/api-contracts';

import {
  deleteStagedAttachmentDirectory,
  stageEncryptedAttachment,
} from '../../../lib/outbox/attachments';
import type { OutboxAttachmentRecord } from '../../../lib/outbox/database';
import { requireJobAttachmentMimeType } from '../../../lib/outbox/image-content';
import type { JobFileRef } from '../../../types';
import {
  describeFinishedJobAttachment,
  getLocalFinishedJobAttachmentUri,
} from './finished-job-outbox-model';

type StagedAttachment = Omit<OutboxAttachmentRecord, 'operationId'>;

const BASE64_IMAGE_PATTERN = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,([a-z0-9+/=\s]+)$/i;
const MAX_BASE64_CHARACTERS = Math.ceil(MAX_JOB_ATTACHMENT_BYTES / 3) * 4;

function decodeBoundedBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  if (normalized.length === 0 || normalized.length > MAX_BASE64_CHARACTERS) {
    throw new Error('The attachment exceeds the 10 MiB upload limit');
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((normalized.length * 3) / 4) - padding;
  if (estimatedBytes <= 0 || estimatedBytes > MAX_JOB_ATTACHMENT_BYTES) {
    throw new Error('The attachment exceeds the 10 MiB upload limit');
  }

  const binary = globalThis.atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.length > MAX_JOB_ATTACHMENT_BYTES) {
    bytes.fill(0);
    throw new Error('The attachment exceeds the 10 MiB upload limit');
  }
  return bytes;
}

function readFileHeader(source: File): Uint8Array {
  const handle = source.open(FileMode.ReadOnly);
  try {
    return handle.readBytes(Math.min(64, source.size));
  } finally {
    handle.close();
  }
}

async function stageLocalAttachment(
  userId: string,
  file: string | JobFileRef,
  kind: 'photo' | 'signature',
  index: number,
): Promise<StagedAttachment> {
  const sourceUri = getLocalFinishedJobAttachmentUri(file);
  const base64Match = BASE64_IMAGE_PATTERN.exec(sourceUri);
  if (base64Match?.[1] && base64Match[2]) {
    const plaintextBytes = decodeBoundedBase64(base64Match[2]);
    try {
      const mimeType = requireJobAttachmentMimeType(
        plaintextBytes.subarray(0, 64),
        base64Match[1],
      );
      const descriptor = describeFinishedJobAttachment(file, kind, mimeType, index);
      return await stageEncryptedAttachment({
        userId,
        sourceBytes: plaintextBytes,
        kind: descriptor.kind,
        fileName: descriptor.fileName,
        mimeType: descriptor.mimeType,
      });
    } finally {
      plaintextBytes.fill(0);
    }
  }

  const source = new File(sourceUri);
  if (!source.exists || source.size <= 0) {
    throw new Error('The attachment source file is unavailable or empty');
  }
  if (source.size > MAX_JOB_ATTACHMENT_BYTES) {
    throw new Error('The attachment exceeds the 10 MiB upload limit');
  }
  const mimeType = requireJobAttachmentMimeType(readFileHeader(source));
  const descriptor = describeFinishedJobAttachment(file, kind, mimeType, index);
  return stageEncryptedAttachment({
    userId,
    sourceUri: descriptor.sourceUri,
    kind: descriptor.kind,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
  });
}

export async function stageFinishedJobAttachments(input: {
  readonly userId: string;
  readonly photos: readonly (string | JobFileRef)[];
  readonly signature: string | JobFileRef;
}): Promise<StagedAttachment[]> {
  const staged: StagedAttachment[] = [];
  try {
    for (let index = 0; index < input.photos.length; index += 1) {
      const photo = input.photos[index];
      if (!photo) continue;
      staged.push(await stageLocalAttachment(input.userId, photo, 'photo', index));
    }
    staged.push(await stageLocalAttachment(input.userId, input.signature, 'signature', 0));
    const totalBytes = staged.reduce((total, attachment) => total + attachment.sizeBytes, 0);
    if (totalBytes > MAX_JOB_ATTACHMENT_TOTAL_BYTES) {
      throw new Error('The combined job attachments must be 50 MB or smaller');
    }
    return staged;
  } catch (error) {
    for (const attachment of staged) {
      deleteStagedAttachmentDirectory(attachment.stagedDirectoryUri);
    }
    throw error;
  }
}
