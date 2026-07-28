import * as SecureStore from 'expo-secure-store';
import {
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  randomUUID,
} from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  JobAttachmentMimeTypeSchema,
  MAX_JOB_ATTACHMENT_BYTES,
} from '@smart-job/api-contracts';

import type { OutboxAttachmentRecord } from './database';
import { requireJobAttachmentMimeType } from './image-content';

const CHUNK_BYTES = 256 * 1_024;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_ID_PATTERN = USER_ID_PATTERN;
const fileKeyPromises = new Map<string, Promise<AESEncryptionKey>>();

function requireUserId(userId: string): string {
  const normalized = userId.trim().toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new Error('A canonical authenticated user id is required for attachment staging');
  }
  return normalized;
}

async function getOrCreateFileKey(userId: string): Promise<AESEncryptionKey> {
  const normalized = requireUserId(userId);
  const active = fileKeyPromises.get(normalized);
  if (active) {
    return active;
  }

  const pending = (async () => {
    const keyName = `smart-job.outbox.file-key.${normalized}`;
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing) {
      return AESEncryptionKey.import(existing, 'base64') as Promise<AESEncryptionKey>;
    }

    const generated = await AESEncryptionKey.generate(AESKeySize.AES256) as AESEncryptionKey;
    await SecureStore.setItemAsync(keyName, await generated.encoded('base64'), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  fileKeyPromises.set(normalized, pending);
  try {
    return await pending;
  } finally {
    if (fileKeyPromises.get(normalized) === pending) {
      fileKeyPromises.delete(normalized);
    }
  }
}

function attachmentDirectory(userId: string, attachmentId: string): Directory {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    throw new Error('A canonical attachment id is required for attachment staging');
  }
  return new Directory(Paths.document, 'smart-job-outbox', userId, attachmentId);
}

function createAttachmentDirectory(userId: string, attachmentId: string): Directory {
  const root = attachmentDirectory(userId, attachmentId);
  root.create({ idempotent: true, intermediates: true });
  return root;
}

function requireOwnedAttachmentDirectoryUri(stagedDirectoryUri: string): Directory {
  const root = new Directory(Paths.document, 'smart-job-outbox');
  const candidate = new Directory(stagedDirectoryUri);
  const rootUri = root.uri.endsWith('/') ? root.uri : `${root.uri}/`;
  if (!candidate.uri.startsWith(rootUri)) {
    throw new Error('The staged attachment directory is outside app-owned storage');
  }
  const relative = candidate.uri.slice(rootUri.length).replace(/\/+$/, '');
  const segments = relative.split('/').map((segment) => decodeURIComponent(segment));
  if (
    segments.length !== 2
    || !USER_ID_PATTERN.test(segments[0] ?? '')
    || !ATTACHMENT_ID_PATTERN.test(segments[1] ?? '')
  ) {
    throw new Error('The staged attachment directory is invalid');
  }
  return candidate;
}

function requireAttachmentDirectory(
  userId: string,
  attachment: Pick<OutboxAttachmentRecord, 'id' | 'stagedDirectoryUri'>,
): Directory {
  const expected = attachmentDirectory(requireUserId(userId), attachment.id);
  const candidate = requireOwnedAttachmentDirectoryUri(attachment.stagedDirectoryUri);
  if (candidate.uri.replace(/\/+$/, '') !== expected.uri.replace(/\/+$/, '')) {
    throw new Error('The staged attachment directory does not match its owner');
  }
  return candidate;
}

export async function stageEncryptedAttachment(input: {
  readonly userId: string;
  readonly kind: 'photo' | 'signature';
  readonly fileName: string;
  readonly mimeType: string;
} & (
  | { readonly sourceUri: string; readonly sourceBytes?: never }
  | { readonly sourceBytes: Uint8Array; readonly sourceUri?: never }
)): Promise<Omit<OutboxAttachmentRecord, 'operationId'>> {
  const normalizedUserId = requireUserId(input.userId);
  const attachmentId = randomUUID();
  const hasSourceBytes = input.sourceBytes instanceof Uint8Array;
  const sourceUri = typeof input.sourceUri === 'string' ? input.sourceUri.trim() : '';
  if (hasSourceBytes === Boolean(sourceUri)) {
    throw new Error('Exactly one attachment source is required');
  }

  let source: File | null = null;
  let sourceSize = 0;
  let header: Uint8Array;
  if (hasSourceBytes) {
    sourceSize = input.sourceBytes.byteLength;
    header = input.sourceBytes.subarray(0, 64);
  } else {
    source = new File(sourceUri);
    if (!source.exists || source.size <= 0) {
      throw new Error('The attachment source file is unavailable or empty');
    }
    sourceSize = source.size;
    const headerHandle = source.open(FileMode.ReadOnly);
    try {
      header = headerHandle.readBytes(Math.min(64, sourceSize));
    } finally {
      headerHandle.close();
    }
  }
  if (sourceSize <= 0) {
    throw new Error('The attachment source is empty');
  }
  if (sourceSize > MAX_JOB_ATTACHMENT_BYTES) {
    throw new Error('The attachment exceeds the 10 MiB upload limit');
  }
  const mimeType = JobAttachmentMimeTypeSchema.parse(input.mimeType);
  requireJobAttachmentMimeType(header, mimeType);
  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 255) {
    throw new Error('The attachment file name is invalid');
  }

  const key = await getOrCreateFileKey(normalizedUserId);
  const directory = createAttachmentDirectory(normalizedUserId, attachmentId);
  const digest = sha256.create();
  let chunkCount = 0;

  try {
    const encryptChunk = async (chunk: Uint8Array) => {
      digest.update(chunk);
      const sealed = await aesEncryptAsync(chunk, key, {
        nonce: { length: 12 },
        tagLength: 16,
      });
      const encrypted = await sealed.combined('bytes');
      const chunkFile = new File(
        directory,
        `${String(chunkCount).padStart(6, '0')}.sjenc`,
      );
      chunkFile.create();
      chunkFile.write(encrypted);
      chunkCount += 1;
    };

    if (hasSourceBytes) {
      for (let offset = 0; offset < input.sourceBytes.length; offset += CHUNK_BYTES) {
        await encryptChunk(input.sourceBytes.subarray(
          offset,
          Math.min(offset + CHUNK_BYTES, input.sourceBytes.length),
        ));
      }
    } else if (source) {
      const handle = source.open(FileMode.ReadOnly);
      try {
        while (handle.offset !== null && handle.size !== null && handle.offset < handle.size) {
          const chunk = handle.readBytes(Math.min(CHUNK_BYTES, handle.size - handle.offset));
          if (chunk.length === 0) {
            break;
          }
          await encryptChunk(chunk);
        }
      } finally {
        handle.close();
      }
    }
  } catch (error) {
    if (directory.exists) {
      directory.delete();
    }
    throw error;
  }

  if (chunkCount === 0) {
    directory.delete();
    throw new Error('The attachment did not contain any readable data');
  }

  return {
    id: attachmentId,
    kind: input.kind,
    fileName,
    mimeType,
    sizeBytes: sourceSize,
    sha256: bytesToHex(digest.digest()),
    stagedDirectoryUri: directory.uri,
    chunkCount,
  };
}

export async function* readDecryptedAttachmentChunks(
  userId: string,
  attachment: OutboxAttachmentRecord,
): AsyncGenerator<Uint8Array> {
  const key = await getOrCreateFileKey(userId);
  const directory = requireAttachmentDirectory(userId, attachment);
  for (let index = 0; index < attachment.chunkCount; index += 1) {
    const chunkFile = new File(
      directory,
      `${String(index).padStart(6, '0')}.sjenc`,
    );
    if (!chunkFile.exists) {
      throw new Error('An encrypted attachment chunk is missing');
    }
    const sealed = AESSealedData.fromCombined(await chunkFile.bytes(), {
      ivLength: 12,
      tagLength: 16,
    });
    yield await aesDecryptAsync(sealed, key, { output: 'bytes' });
  }
}

export function deleteStagedAttachment(attachment: OutboxAttachmentRecord): void {
  deleteStagedAttachmentDirectory(attachment.stagedDirectoryUri);
}

export function deleteStagedAttachmentDirectory(stagedDirectoryUri: string): void {
  const directory = requireOwnedAttachmentDirectoryUri(stagedDirectoryUri);
  if (directory.exists) {
    directory.delete();
  }
}
