import { createJobAttachmentDownload } from './jobs-api';

export interface JobFileRef {
  attachmentId?: string;
  kind?: 'photo' | 'signature';
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;
  uri?: string;
  url?: string;
}

function isLocalPreviewUri(value: string): boolean {
  return (
    value.startsWith('file:') ||
    value.startsWith('content:') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('ph:') ||
    value.startsWith('asset-library:')
  );
}

export function getImmediateJobFileUri(file: unknown): string | null {
  if (!file) return null;

  if (typeof file === 'string') {
    return isLocalPreviewUri(file) ? file : null;
  }

  if (typeof file === 'object' && !Array.isArray(file)) {
    const typed = file as JobFileRef;
    if (typeof typed.uri === 'string' && isLocalPreviewUri(typed.uri)) {
      return typed.uri;
    }
    if (typeof typed.url === 'string' && isLocalPreviewUri(typed.url)) {
      return typed.url;
    }
  }

  return null;
}

export async function getJobFileDownloadUrl(
  uid: string,
  companyId: number,
  jobId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!uid.trim() || !attachmentId.trim()) {
    throw new Error('Job file download URL is unavailable');
  }
  const access = await createJobAttachmentDownload({
    uid,
    companyId,
    jobId,
    attachmentId,
    signal,
  });
  return access.downloadURL;
}

export async function resolveJobFileUri(
  file: unknown,
  uid: string | null | undefined,
  companyId: number | null | undefined,
  jobId: string | null | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const localUri = getImmediateJobFileUri(file);
  if (localUri) return localUri;

  const attachmentId = typeof file === 'object' && file !== null && !Array.isArray(file)
    ? String((file as JobFileRef).attachmentId ?? '').trim()
    : '';
  if (!attachmentId || !uid || !companyId || !jobId) {
    return null;
  }

  return getJobFileDownloadUrl(uid, companyId, jobId, attachmentId, signal);
}
