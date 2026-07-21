import { createHash, timingSafeEqual } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  hasLocalPlatformOverrides,
  isVerifiedLocalPlatform,
  type LocalMarkerReader,
} from './local-platform';

export const COMPANY_FILES_BUCKET = 'smart-job-company-files';
export const MAX_COMPANY_FILE_BYTES = 10 * 1024 * 1024;

type StorageBucketClient = ReturnType<SupabaseClient['storage']['from']>;

type CompanyFileStorageOptions = {
  baseUrl: URL;
  publicBaseUrl?: URL;
  verifiedLocalPlatform?: boolean;
  secretKey: string;
  bucketId?: string;
  client?: SupabaseClient;
};

type PdfMetadata = Record<string, string>;

export type StoredPdfResult = {
  objectPath: string;
  sha256: string;
  created: boolean;
};

export type OptionalImage = {
  bytes: Buffer;
  contentType: 'image/png' | 'image/jpeg';
};

export interface CompanyFileStorage {
  storePdfCreateOnly(objectPath: string, bytes: Buffer, metadata?: PdfMetadata): Promise<StoredPdfResult>;
  createSignedDownloadUrl(objectPath: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectPath: string): Promise<void>;
  downloadOptionalImage(objectPath: string, maxBytes: number): Promise<OptionalImage | null>;
}

export class CompanyFileStorageError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CompanyFileStorageError';
    this.code = code;
    this.retryable = retryable;
  }
}

function storageError(code: string, message: string, cause?: unknown): CompanyFileStorageError {
  return new CompanyFileStorageError(code, message, true, cause);
}

function storageConflict(message: string, cause?: unknown): CompanyFileStorageError {
  return new CompanyFileStorageError('storage_object_conflict', message, false, cause);
}

function storageStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const raw = (error as { statusCode?: unknown; status?: unknown }).statusCode
    ?? (error as { status?: unknown }).status;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function storageCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '').trim().toLowerCase();
}

function storageMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { message?: unknown }).message || '').trim().toLowerCase();
}

function isAlreadyExists(error: unknown): boolean {
  const status = storageStatus(error);
  const code = storageCode(error);
  const message = storageMessage(error);
  return status === 409
    || code === 'already_exists'
    || code === 'resource_already_exists'
    || ((status === 400 || status === null) && /already exists|asset exists|duplicate/.test(message));
}

function isNotFound(error: unknown): boolean {
  const status = storageStatus(error);
  const code = storageCode(error);
  return status === 404 || code === 'not_found' || code === 'no_such_key';
}

function normalizeObjectPath(value: unknown): string {
  const objectPath = String(value || '').trim();
  if (!objectPath || objectPath.length > 1024 || objectPath.startsWith('/') || objectPath.endsWith('/')) {
    throw new TypeError('Storage object path is invalid');
  }
  const segments = objectPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(segment))) {
    throw new TypeError('Storage object path is invalid');
  }
  return objectPath;
}

function encodedStoragePath(bucketId: string, objectPath: string): string {
  return [bucketId, ...objectPath.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function downloadBytes(bucket: StorageBucketClient, objectPath: string): Promise<Buffer> {
  let response: Awaited<ReturnType<StorageBucketClient['download']>>;
  try {
    response = await bucket.download(objectPath);
  } catch (error) {
    throw storageError('storage_unavailable', 'Company file storage is unavailable', error);
  }
  if (response.error || !response.data) {
    throw storageError('storage_unavailable', 'Company file storage is unavailable', response.error);
  }
  try {
    return Buffer.from(await response.data.arrayBuffer());
  } catch (error) {
    throw storageError('storage_unavailable', 'Company file storage returned an unreadable object', error);
  }
}

async function verifyExistingPdf(
  bucket: StorageBucketClient,
  objectPath: string,
  expectedBytes: Buffer,
  expectedHash: string,
): Promise<void> {
  let info: Awaited<ReturnType<StorageBucketClient['info']>>;
  try {
    info = await bucket.info(objectPath);
  } catch (error) {
    throw storageError('storage_unavailable', 'Unable to verify an existing PDF object', error);
  }
  if (info.error || !info.data) {
    throw storageError('storage_unavailable', 'Unable to verify an existing PDF object', info.error);
  }
  if (Number(info.data.size) !== expectedBytes.length) {
    throw storageConflict('A different PDF already exists at the generated document path');
  }
  const contentType = String(info.data.contentType || '').split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/pdf') {
    throw storageConflict('A non-PDF object already exists at the generated document path');
  }

  const existingBytes = await downloadBytes(bucket, objectPath);
  const existingHash = createHash('sha256').update(existingBytes).digest('hex');
  if (existingBytes.length !== expectedBytes.length || !hashesMatch(existingHash, expectedHash)) {
    throw storageConflict('A different PDF already exists at the generated document path');
  }
}

function validateStorageConfiguration(options: CompanyFileStorageOptions): void {
  if (options.baseUrl.username || options.baseUrl.password || options.baseUrl.search || options.baseUrl.hash) {
    throw new TypeError('SUPABASE_URL must not contain credentials, query parameters, or fragments');
  }
  const isHttps = options.baseUrl.protocol === 'https:';
  const isLoopbackHttp = options.baseUrl.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(options.baseUrl.hostname.toLowerCase());
  const isVerifiedLocalService = options.verifiedLocalPlatform === true
    && options.baseUrl.protocol === 'http:'
    && options.baseUrl.hostname === 'supabase_kong_smart-job-erp-local'
    && options.baseUrl.port === '8000';
  if (!isHttps && !isLoopbackHttp && !isVerifiedLocalService) {
    throw new TypeError('SUPABASE_URL must use HTTPS, except for loopback local development');
  }
  if (options.baseUrl.pathname !== '/' || !/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) {
    throw new TypeError('A root Supabase URL and server-only SUPABASE_SECRET_KEY are required');
  }
  if ((options.bucketId || COMPANY_FILES_BUCKET) !== COMPANY_FILES_BUCKET) {
    throw new TypeError(`SUPABASE_STORAGE_BUCKET must be ${COMPANY_FILES_BUCKET}`);
  }
  if (options.publicBaseUrl !== undefined) {
    const publicUrl = options.publicBaseUrl;
    const publicLoopback = publicUrl.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(publicUrl.hostname.toLowerCase());
    if (
      options.verifiedLocalPlatform !== true
      || !publicLoopback
      || publicUrl.username
      || publicUrl.password
      || publicUrl.pathname !== '/'
      || publicUrl.search
      || publicUrl.hash
    ) {
      throw new TypeError('SUPABASE_PUBLIC_URL is invalid');
    }
  }
}

export function resolveCompanyFileStorageConfig(
  env = process.env,
  readMarker?: LocalMarkerReader,
): {
  baseUrl: URL;
  publicBaseUrl?: URL;
  verifiedLocalPlatform?: boolean;
  secretKey: string;
  bucketId: typeof COMPANY_FILES_BUCKET;
} {
  const urlValue = String(env.SUPABASE_URL || '').trim();
  const publicUrlValue = String(env.SUPABASE_PUBLIC_URL || '').trim();
  const secretKey = String(env.SUPABASE_SECRET_KEY || '').trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(urlValue);
  } catch (error) {
    throw new TypeError('SUPABASE_URL must be an absolute URL', { cause: error });
  }
  const bucketId = String(env.SUPABASE_STORAGE_BUCKET || COMPANY_FILES_BUCKET).trim();
  const verifiedLocalPlatform = isVerifiedLocalPlatform(env, readMarker);
  if (hasLocalPlatformOverrides(env) && !verifiedLocalPlatform) {
    throw new TypeError('Local storage overrides require the mounted local-platform marker');
  }
  let publicBaseUrl: URL | undefined;
  if (publicUrlValue) {
    try {
      publicBaseUrl = new URL(publicUrlValue);
    } catch (error) {
      throw new TypeError('SUPABASE_PUBLIC_URL must be an absolute URL', { cause: error });
    }
  }
  const options = {
    baseUrl,
    secretKey,
    bucketId,
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
    ...(verifiedLocalPlatform ? { verifiedLocalPlatform: true } : {}),
  };
  validateStorageConfiguration(options);
  return { ...options, bucketId: COMPANY_FILES_BUCKET };
}

export function createCompanyFileStorage(options: CompanyFileStorageOptions): CompanyFileStorage {
  validateStorageConfiguration(options);
  const bucketId = options.bucketId || COMPANY_FILES_BUCKET;
  const client = options.client || createClient(options.baseUrl.href, options.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const bucket = client.storage.from(bucketId);

  const externalizeSignedUrl = (url: URL): string => {
    if (options.publicBaseUrl === undefined) return url.href;
    return new URL(`${url.pathname}${url.search}`, options.publicBaseUrl).href;
  };

  return {
    async storePdfCreateOnly(rawObjectPath, bytes, metadata = {}) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_COMPANY_FILE_BYTES) {
        throw new TypeError(`PDF must contain between 1 and ${MAX_COMPANY_FILE_BYTES} bytes`);
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      let upload: Awaited<ReturnType<StorageBucketClient['upload']>>;
      try {
        upload = await bucket.upload(objectPath, bytes, {
          cacheControl: '3600',
          contentType: 'application/pdf',
          metadata: { ...metadata, sha256 },
          upsert: false,
        });
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to store generated PDF', error);
      }
      if (upload.error) {
        if (!isAlreadyExists(upload.error)) {
          throw storageError('storage_unavailable', 'Unable to store generated PDF', upload.error);
        }
        await verifyExistingPdf(bucket, objectPath, bytes, sha256);
        return { objectPath, sha256, created: false };
      }
      if (!upload.data || String(upload.data.path || '') !== objectPath) {
        throw storageError('storage_invalid_response', 'Storage returned an invalid PDF object path');
      }
      return { objectPath, sha256, created: true };
    },

    async createSignedDownloadUrl(rawObjectPath, expiresInSeconds) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 24 * 60 * 60) {
        throw new TypeError('Signed download expiry must be between 60 seconds and 24 hours');
      }
      let signed: Awaited<ReturnType<StorageBucketClient['createSignedUrl']>>;
      try {
        signed = await bucket.createSignedUrl(objectPath, expiresInSeconds);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to sign generated PDF', error);
      }
      if (signed.error || !signed.data?.signedUrl) {
        throw storageError('storage_unavailable', 'Unable to sign generated PDF', signed.error);
      }
      let signedUrl: URL;
      try {
        signedUrl = new URL(signed.data.signedUrl, options.baseUrl);
      } catch (error) {
        throw storageError('storage_invalid_response', 'Storage returned an invalid signed URL', error);
      }
      const expectedPath = `/storage/v1/object/sign/${encodedStoragePath(bucketId, objectPath)}`;
      if (signedUrl.origin !== options.baseUrl.origin || signedUrl.pathname !== expectedPath || !signedUrl.searchParams.get('token')) {
        throw storageError('storage_invalid_response', 'Storage returned an invalid signed URL');
      }
      return externalizeSignedUrl(signedUrl);
    },

    async removeObject(rawObjectPath) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      let removed: Awaited<ReturnType<StorageBucketClient['remove']>>;
      try {
        removed = await bucket.remove([objectPath]);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to remove generated PDF', error);
      }
      if (removed.error && !isNotFound(removed.error)) {
        throw storageError('storage_unavailable', 'Unable to remove generated PDF', removed.error);
      }
    },

    async downloadOptionalImage(rawObjectPath, maxBytes) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_COMPANY_FILE_BYTES) {
        throw new TypeError('Image size limit is invalid');
      }
      let info: Awaited<ReturnType<StorageBucketClient['info']>>;
      try {
        info = await bucket.info(objectPath);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to read company branding', error);
      }
      if (info.error || !info.data) {
        if (isNotFound(info.error)) return null;
        throw storageError('storage_unavailable', 'Unable to read company branding', info.error);
      }
      const size = Number(info.data.size);
      if (!Number.isFinite(size) || size < 1 || size > maxBytes) {
        throw storageConflict('Company logo exceeds the permitted size');
      }
      const contentType = String(info.data.contentType || '').split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
        throw storageConflict('Company logo has an unsupported content type');
      }
      const bytes = await downloadBytes(bucket, objectPath);
      if (bytes.length !== size || bytes.length > maxBytes) {
        throw storageConflict('Company logo size changed while it was being read');
      }
      return { bytes, contentType };
    },
  };
}

export function createCompanyFileStorageFromEnv(env = process.env): CompanyFileStorage {
  return createCompanyFileStorage(resolveCompanyFileStorageConfig(env));
}
