import { createHash, timingSafeEqual } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import {
  hasLocalPlatformOverrides,
  isVerifiedLocalPlatform,
  type LocalMarkerReader,
} from './local-platform';

export const COMPANY_FILES_BUCKET = 'smart-job-company-files';
export const MAX_COMPANY_FILE_BYTES = 10 * 1024 * 1024;

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
  checkReadiness(): Promise<void>;
  storePdfCreateOnly(objectPath: string, bytes: Buffer, metadata?: PdfMetadata): Promise<StoredPdfResult>;
  createSignedDownloadUrl(objectPath: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectPath: string): Promise<void>;
  downloadOptionalImage(objectPath: string, maxBytes: number): Promise<OptionalImage | null>;
}

export interface PdfObjectMetadata {
  sizeBytes: number;
  contentType: string;
}

export interface PdfObjectStore {
  checkReadiness(): Promise<void>;
  saveCreateOnly(
    objectPath: string,
    bytes: Buffer,
    metadata: PdfMetadata,
  ): Promise<'created' | 'exists'>;
  getMetadata(objectPath: string): Promise<PdfObjectMetadata | null>;
  download(objectPath: string): Promise<Buffer>;
  createSignedDownloadUrl(objectPath: string, expiresAt: number): Promise<string>;
  remove(objectPath: string): Promise<void>;
}

type CompanyFileStorageOptions = {
  projectId?: string;
  apiEndpoint?: string;
  publicBaseUrl?: URL;
  verifiedLocalPlatform?: boolean;
  bucketId?: string;
  objectStore?: PdfObjectStore;
  now?: () => number;
};

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
  const raw = Reflect.get(error, 'code') ?? Reflect.get(error, 'statusCode');
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function isAlreadyExists(error: unknown): boolean {
  return storageStatus(error) === 409 || storageStatus(error) === 412;
}

function isNotFound(error: unknown): boolean {
  return storageStatus(error) === 404;
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

function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function validateStorageConfiguration(options: CompanyFileStorageOptions): void {
  const bucketId = options.bucketId || COMPANY_FILES_BUCKET;
  if (
    bucketId.length < 3
    || bucketId.length > 63
    || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucketId)
    || bucketId.includes('..')
  ) {
    throw new TypeError('COMPANY_FILES_BUCKET must be a valid GCS bucket name');
  }
  if (options.publicBaseUrl !== undefined) {
    const url = options.publicBaseUrl;
    const loopback = url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase());
    if (
      options.verifiedLocalPlatform !== true
      || !loopback
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      throw new TypeError('COMPANY_FILES_PUBLIC_BASE_URL is invalid');
    }
  }
  if (options.apiEndpoint !== undefined && options.verifiedLocalPlatform !== true) {
    throw new TypeError('GCS_API_ENDPOINT is available only in the verified local platform');
  }
}

function encodeObjectPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

export function resolveCompanyFileStorageConfig(
  env = process.env,
  readMarker?: LocalMarkerReader,
): CompanyFileStorageOptions & { bucketId: string } {
  const verifiedLocalPlatform = isVerifiedLocalPlatform(env, readMarker);
  if (hasLocalPlatformOverrides(env) && !verifiedLocalPlatform) {
    throw new TypeError('Local storage overrides require the mounted local-platform marker');
  }
  const bucketId = String(env.COMPANY_FILES_BUCKET || COMPANY_FILES_BUCKET).trim();
  const apiEndpoint = String(env.GCS_API_ENDPOINT || '').trim();
  const publicUrlValue = String(env.COMPANY_FILES_PUBLIC_BASE_URL || '').trim();
  let publicBaseUrl: URL | undefined;
  if (publicUrlValue) {
    try {
      publicBaseUrl = new URL(publicUrlValue);
    } catch (error) {
      throw new TypeError('COMPANY_FILES_PUBLIC_BASE_URL must be an absolute URL', { cause: error });
    }
  }
  const options: CompanyFileStorageOptions = {
    ...(String(env.GCS_PROJECT_ID || '').trim()
      ? { projectId: String(env.GCS_PROJECT_ID).trim() }
      : {}),
    ...(apiEndpoint ? { apiEndpoint } : {}),
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
    ...(verifiedLocalPlatform ? { verifiedLocalPlatform: true } : {}),
    bucketId,
  };
  if (verifiedLocalPlatform && (!options.apiEndpoint || !options.publicBaseUrl)) {
    throw new TypeError('Local PDF storage requires internal and public GCS emulator URLs');
  }
  validateStorageConfiguration(options);
  return { ...options, bucketId };
}

export function createGcsPdfObjectStore(options: CompanyFileStorageOptions): PdfObjectStore {
  validateStorageConfiguration(options);
  const bucketId = options.bucketId || COMPANY_FILES_BUCKET;
  const storage = new Storage({
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    ...(options.apiEndpoint === undefined ? {} : { apiEndpoint: options.apiEndpoint }),
  });
  const bucket = storage.bucket(bucketId);

  return {
    async checkReadiness() {
      try {
        await bucket.getMetadata();
      } catch (error) {
        if (!isNotFound(error) || options.publicBaseUrl === undefined) throw error;
        try {
          await storage.createBucket(bucketId);
        } catch (createError) {
          if (!isAlreadyExists(createError)) throw createError;
        }
        await bucket.getMetadata();
      }
    },

    async saveCreateOnly(objectPath, bytes, metadata) {
      try {
        await bucket.file(objectPath).save(bytes, {
          resumable: false,
          validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'private, max-age=3600',
            metadata,
          },
        });
        return 'created';
      } catch (error) {
        if (isAlreadyExists(error)) return 'exists';
        throw error;
      }
    },

    async getMetadata(objectPath) {
      try {
        const [metadata] = await bucket.file(objectPath).getMetadata();
        const sizeBytes = Number(metadata.size);
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
          throw new Error('GCS returned an invalid object size');
        }
        return { sizeBytes, contentType: String(metadata.contentType || '') };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async download(objectPath) {
      const [bytes] = await bucket.file(objectPath).download();
      return bytes;
    },

    async createSignedDownloadUrl(objectPath, expiresAt) {
      if (options.publicBaseUrl !== undefined) {
        return new URL(
          `${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
          options.publicBaseUrl,
        ).href;
      }
      const [url] = await bucket.file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAt,
      });
      return url;
    },

    async remove(objectPath) {
      await bucket.file(objectPath).delete({ ignoreNotFound: true });
    },
  };
}

export function createCompanyFileStorage(options: CompanyFileStorageOptions): CompanyFileStorage {
  validateStorageConfiguration(options);
  const objectStore = options.objectStore || createGcsPdfObjectStore(options);
  const now = options.now || Date.now;

  const verifyExistingPdf = async (
    objectPath: string,
    expectedBytes: Buffer,
    expectedHash: string,
  ): Promise<void> => {
    let info: PdfObjectMetadata | null;
    try {
      info = await objectStore.getMetadata(objectPath);
    } catch (error) {
      throw storageError('storage_unavailable', 'Unable to verify an existing PDF object', error);
    }
    if (info === null) {
      throw storageError('storage_unavailable', 'Unable to verify an existing PDF object');
    }
    if (info.sizeBytes !== expectedBytes.length) {
      throw storageConflict('A different PDF already exists at the generated document path');
    }
    const contentType = info.contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/pdf') {
      throw storageConflict('A non-PDF object already exists at the generated document path');
    }
    let existingBytes: Buffer;
    try {
      existingBytes = await objectStore.download(objectPath);
    } catch (error) {
      throw storageError('storage_unavailable', 'Unable to verify an existing PDF object', error);
    }
    const existingHash = createHash('sha256').update(existingBytes).digest('hex');
    if (existingBytes.length !== expectedBytes.length || !hashesMatch(existingHash, expectedHash)) {
      throw storageConflict('A different PDF already exists at the generated document path');
    }
  };

  return {
    async checkReadiness() {
      try {
        await objectStore.checkReadiness();
      } catch (error) {
        throw storageError('storage_unavailable', 'Private company-file storage is unavailable', error);
      }
    },

    async storePdfCreateOnly(rawObjectPath, bytes, metadata = {}) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_COMPANY_FILE_BYTES) {
        throw new TypeError(`PDF must contain between 1 and ${MAX_COMPANY_FILE_BYTES} bytes`);
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      let result: 'created' | 'exists';
      try {
        result = await objectStore.saveCreateOnly(objectPath, bytes, { ...metadata, sha256 });
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to store generated PDF', error);
      }
      if (result === 'exists') {
        await verifyExistingPdf(objectPath, bytes, sha256);
      }
      return { objectPath, sha256, created: result === 'created' };
    },

    async createSignedDownloadUrl(rawObjectPath, expiresInSeconds) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 24 * 60 * 60) {
        throw new TypeError('Signed download expiry must be between 60 seconds and 24 hours');
      }
      try {
        return new URL(
          await objectStore.createSignedDownloadUrl(
            objectPath,
            now() + expiresInSeconds * 1_000,
          ),
        ).href;
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to sign generated PDF', error);
      }
    },

    async removeObject(rawObjectPath) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      try {
        await objectStore.remove(objectPath);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to remove generated PDF', error);
      }
    },

    async downloadOptionalImage(rawObjectPath, maxBytes) {
      const objectPath = normalizeObjectPath(rawObjectPath);
      if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_COMPANY_FILE_BYTES) {
        throw new TypeError('Image size limit is invalid');
      }
      let info: PdfObjectMetadata | null;
      try {
        info = await objectStore.getMetadata(objectPath);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to read company branding', error);
      }
      if (info === null) return null;
      if (info.sizeBytes < 1 || info.sizeBytes > maxBytes) {
        throw storageConflict('Company logo exceeds the permitted size');
      }
      const contentType = info.contentType.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
        throw storageConflict('Company logo has an unsupported content type');
      }
      let bytes: Buffer;
      try {
        bytes = await objectStore.download(objectPath);
      } catch (error) {
        throw storageError('storage_unavailable', 'Unable to read company branding', error);
      }
      if (bytes.length !== info.sizeBytes || bytes.length > maxBytes) {
        throw storageConflict('Company logo size changed while it was being read');
      }
      return { bytes, contentType };
    },
  };
}

export function createCompanyFileStorageFromEnv(env = process.env): CompanyFileStorage {
  return createCompanyFileStorage(resolveCompanyFileStorageConfig(env));
}
