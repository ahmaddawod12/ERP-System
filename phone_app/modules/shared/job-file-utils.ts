import { functions, httpsCallable } from '../../firebase';

export interface JobFileRef {
  storagePath?: string;
  uri?: string;
  url?: string;
}

function normalizeStoragePath(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('?')) {
    return null;
  }
  return normalized;
}

function extractStoragePathFromUrl(rawValue: string): string | null {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  if (raw.startsWith('gs://')) {
    const withoutScheme = raw.slice(5);
    const firstSlash = withoutScheme.indexOf('/');
    return firstSlash >= 0 ? normalizeStoragePath(withoutScheme.slice(firstSlash + 1)) : null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const marker = '/o/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) return null;
      return normalizeStoragePath(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)));
    }

    if (parsed.hostname === 'storage.googleapis.com') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) return null;
      return normalizeStoragePath(pathParts.slice(1).join('/'));
    }
  } catch {
    return null;
  }

  return null;
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

export function extractStoragePathFromJobFile(file: unknown): string | null {
  if (!file) return null;

  if (typeof file === 'object' && !Array.isArray(file)) {
    const typed = file as JobFileRef;
    return (
      normalizeStoragePath(typed.storagePath) ||
      (typeof typed.url === 'string' ? extractStoragePathFromUrl(typed.url) : null) ||
      (typeof typed.uri === 'string' ? extractStoragePathFromUrl(typed.uri) : null)
    );
  }

  if (typeof file === 'string') {
    return extractStoragePathFromUrl(file);
  }

  return null;
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
  companyId: string,
  jobId: string,
  storagePath: string,
): Promise<string> {
  const callable = httpsCallable(functions, 'createJobFileDownloadUrlV1');
  const result = await callable({ companyId, jobId, storagePath }) as {
    data?: { success?: boolean; downloadURL?: string };
  };

  if (!result?.data?.success || !result.data.downloadURL) {
    throw new Error('Job file download URL is unavailable');
  }

  return result.data.downloadURL;
}

export async function resolveJobFileUri(
  file: unknown,
  companyId: string | null | undefined,
  jobId: string | null | undefined,
): Promise<string | null> {
  const localUri = getImmediateJobFileUri(file);
  if (localUri) return localUri;

  const storagePath = extractStoragePathFromJobFile(file);
  if (!storagePath || !companyId || !jobId) {
    return null;
  }

  return getJobFileDownloadUrl(companyId, jobId, storagePath);
}
