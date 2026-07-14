import { fetch as expoFetch } from 'expo/fetch';
import type { SignedUploadTarget } from '@smart-job/api-contracts';

import { ApiClientError } from '../api/client';
import { readDecryptedAttachmentChunks } from './attachments';
import type { OutboxAttachmentRecord } from './database';

const UPLOAD_TIMEOUT_MS = 60_000;
const COMPANY_FILE_BUCKET = 'smart-job-company-files';

function encodedObjectPath(objectPath: string): string {
  return [COMPANY_FILE_BUCKET, ...objectPath.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function verifiedUploadUrl(target: SignedUploadTarget): URL {
  const configuredSupabaseUrl = String(
    process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  ).trim();
  let expectedOrigin: string;
  let uploadUrl: URL;
  try {
    expectedOrigin = new URL(configuredSupabaseUrl).origin;
    uploadUrl = new URL(target.uploadUrl);
  } catch {
    throw new ApiClientError(
      'File storage is not configured for this build',
      0,
      'UPLOAD_TARGET_INVALID',
      false,
    );
  }
  if (
    uploadUrl.origin !== expectedOrigin
    || uploadUrl.pathname
      !== `/storage/v1/object/upload/sign/${encodedObjectPath(target.objectPath)}`
    || !uploadUrl.searchParams.get('token')
    || uploadUrl.hash !== ''
  ) {
    throw new ApiClientError(
      'The backend returned an invalid file upload target',
      0,
      'UPLOAD_TARGET_INVALID',
      false,
    );
  }
  return uploadUrl;
}

async function readPlaintextUploadBytes(
  userId: string,
  attachment: OutboxAttachmentRecord,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(new ArrayBuffer(attachment.sizeBytes));
  let writtenBytes = 0;
  for await (const chunk of readDecryptedAttachmentChunks(userId, attachment)) {
    if (writtenBytes + chunk.byteLength > attachment.sizeBytes) {
      bytes.fill(0);
      throw new Error('The staged attachment is larger than its manifest');
    }
    bytes.set(chunk, writtenBytes);
    writtenBytes += chunk.byteLength;
  }
  if (writtenBytes !== attachment.sizeBytes) {
    bytes.fill(0);
    throw new Error('The staged attachment is incomplete');
  }
  return bytes;
}

export async function uploadEncryptedAttachment(
  userId: string,
  attachment: OutboxAttachmentRecord,
  target: SignedUploadTarget,
): Promise<void> {
  if (
    target.attachmentId !== attachment.id
    || target.sizeBytes !== attachment.sizeBytes
    || target.sha256.toLowerCase() !== attachment.sha256.toLowerCase()
    || target.mimeType !== attachment.mimeType
    || target.kind !== attachment.kind
  ) {
    throw new ApiClientError(
      'The signed upload target does not match the staged attachment',
      0,
      'UPLOAD_TARGET_MISMATCH',
      false,
    );
  }

  const uploadUrl = verifiedUploadUrl(target);
  // Files remain encrypted on disk. A single bounded file (maximum 10 MiB by
  // contract) is decrypted only into memory for the native upload request.
  let plaintextBytes: Uint8Array<ArrayBuffer>;
  try {
    plaintextBytes = await readPlaintextUploadBytes(userId, attachment);
  } catch (cause: unknown) {
    throw new ApiClientError(
      cause instanceof Error ? cause.message : 'The staged attachment cannot be read',
      0,
      'STAGED_ATTACHMENT_INVALID',
      false,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await expoFetch(uploadUrl, {
      method: 'PUT',
      headers: target.requiredHeaders,
      body: plaintextBytes.buffer,
      redirect: 'error',
      signal: controller.signal,
    });
    // A retried create-only upload may report an existing object. The final
    // server-side size/MIME/SHA verification decides whether it is acceptable.
    if (!response.ok && response.status !== 400 && response.status !== 409) {
      throw new ApiClientError(
        'File upload failed',
        response.status,
        'UPLOAD_FAILED',
        response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500,
      );
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(
      'File upload timed out or lost connectivity',
      0,
      'UPLOAD_NETWORK_ERROR',
      true,
    );
  } finally {
    clearTimeout(timeout);
    plaintextBytes.fill(0);
  }
}
