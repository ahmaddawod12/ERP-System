import { functions, httpsCallable, storage as fbStorage } from '../../firebase';

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

export async function uploadFileToJobStorage(
  fileRef: string | JobFileRef | null | undefined,
  companyId: string,
  jobId: string,
  fileName: string,
): Promise<{ storagePath: string; uploaded: boolean }> {
  const existingStoragePath = extractStoragePathFromJobFile(fileRef);
  if (existingStoragePath) {
    return { storagePath: existingStoragePath, uploaded: false };
  }

  const localUri = getImmediateJobFileUri(fileRef);
  if (!localUri) {
    throw new Error('Job file must be a local URI or canonical storage reference');
  }

  const storagePath = `companies/${companyId}/jobs/${jobId}/${fileName}`;
  const storageRef = fbStorage().ref(storagePath);
  await storageRef.putFile(localUri);

  return { storagePath, uploaded: true };
}

export async function uploadJobFilesForStorage(
  companyId: string,
  jobId: string,
  photos: Array<string | JobFileRef>,
  signature: string | JobFileRef | null,
): Promise<{
  photoRefs: Array<{ storagePath: string; uploaded: boolean }>;
  signatureRef: { storagePath: string; uploaded: boolean } | null;
  uploadedStoragePaths: string[];
}> {
  const photoRefs: Array<{ storagePath: string; uploaded: boolean }> = [];
  let signatureRef: { storagePath: string; uploaded: boolean } | null = null;
  const uploadedStoragePaths: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photoRef = await uploadFileToJobStorage(photos[i], companyId, jobId, `photo_${i + 1}.jpg`);
    photoRefs.push(photoRef);
    if (photoRef.uploaded && photoRef.storagePath) {
      uploadedStoragePaths.push(photoRef.storagePath);
    }
  }

  if (signature) {
    signatureRef = await uploadFileToJobStorage(signature, companyId, jobId, 'signature.png');
    if (signatureRef.uploaded && signatureRef.storagePath) {
      uploadedStoragePaths.push(signatureRef.storagePath);
    }
  }

  return { photoRefs, signatureRef, uploadedStoragePaths };
}

export async function cleanupUploadedJobFiles(storagePaths: string[]) {
  const uniquePaths = [...new Set((Array.isArray(storagePaths) ? storagePaths : []).filter(Boolean))];
  if (uniquePaths.length === 0) {
    return;
  }

  await Promise.all(uniquePaths.map(async (storagePath) => {
    try {
      await fbStorage().ref(storagePath).delete();
    } catch (cleanupError) {
      console.warn('Failed to remove orphaned upload:', storagePath, cleanupError);
    }
  }));
}
