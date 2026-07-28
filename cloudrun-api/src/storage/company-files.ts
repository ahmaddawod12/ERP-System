import { createHash, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";

import {
  SignedUploadTargetSchema,
  type SignedUploadTarget,
  type UploadAttachmentManifest,
} from "@smart-job/api-contracts";
import { Storage } from "@google-cloud/storage";

import { AppError } from "../http/errors.js";

const VERIFY_CONCURRENCY = 4;
const MIME_SNIFF_BYTES = 32;
const SIGNED_UPLOAD_EXPIRY_MS = 10 * 60 * 1_000;

export interface StoredUploadAttachment extends UploadAttachmentManifest {
  readonly objectPath: string;
}

export interface CompanyFileStorage {
  checkReadiness?(): Promise<void>;
  createSignedUploadTargets(
    attachments: readonly StoredUploadAttachment[],
  ): Promise<SignedUploadTarget[]>;
  verifyUploadedAttachments(
    attachments: readonly StoredUploadAttachment[],
  ): Promise<void>;
  createSignedDownloadUrl?(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string>;
  removeObjects(objectPaths: readonly string[]): Promise<void>;
}

export interface CompanyFileObjectMetadata {
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface CompanyFileObjectStore {
  checkReadiness(): Promise<void>;
  createSignedUploadUrl(input: {
    readonly objectPath: string;
    readonly contentType: string;
    readonly expiresAt: number;
  }): Promise<string>;
  getMetadata(objectPath: string): Promise<CompanyFileObjectMetadata | null>;
  createReadStream(objectPath: string): Readable;
  createSignedDownloadUrl(input: {
    readonly objectPath: string;
    readonly expiresAt: number;
  }): Promise<string>;
  removeObject(objectPath: string): Promise<void>;
}

export interface CreateCompanyFileStorageOptions {
  readonly bucketId: string;
  readonly projectId?: string;
  readonly apiEndpoint?: string;
  readonly publicBaseUrl?: URL;
  readonly objectStore?: CompanyFileObjectStore;
  readonly now?: () => number;
}

function storageUnavailable(cause: unknown): AppError {
  return new AppError({
    statusCode: 503,
    code: "STORAGE_UNAVAILABLE",
    message: "File storage is temporarily unavailable.",
    retryable: true,
    cause,
  });
}

function objectNotReady(cause: unknown): AppError {
  return new AppError({
    statusCode: 425,
    code: "UPLOAD_OBJECT_NOT_READY",
    message: "One or more files have not finished uploading.",
    retryable: true,
    cause,
  });
}

function invalidUpload(message: string, cause?: unknown): AppError {
  return new AppError({
    statusCode: 400,
    code: "UPLOAD_OBJECT_INVALID",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function normalizedObjectPath(value: string): string {
  const objectPath = value.trim();
  const segments = objectPath.split("/");
  if (
    objectPath.length < 1
    || objectPath.length > 1024
    || objectPath.startsWith("/")
    || objectPath.endsWith("/")
    || segments.some((segment) => (
      !segment
      || segment === "."
      || segment === ".."
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(segment)
    ))
  ) {
    throw new TypeError("Storage object path is invalid");
  }
  return objectPath;
}

function validateBucketId(bucketId: string): void {
  if (
    bucketId.length < 3
    || bucketId.length > 63
    || !/^[a-z0-9][a-z0-9._-]+[a-z0-9]$/.test(bucketId)
    || bucketId.includes("..")
  ) {
    throw new TypeError("The company-file GCS bucket name is invalid");
  }
}

function validatePublicBaseUrl(value: URL | undefined): void {
  if (value === undefined) return;
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (
    value.protocol !== "http:"
    || !loopback.has(value.hostname)
    || value.username
    || value.password
    || value.pathname !== "/"
    || value.search
    || value.hash
  ) {
    throw new TypeError("The local GCS public URL must be an exact loopback HTTP origin");
  }
}

function equalHex(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function hasPrefix(value: Buffer, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function isoBaseMediaBrands(value: Buffer): Set<string> {
  if (value.length < 12 || value.toString("ascii", 4, 8) !== "ftyp") {
    return new Set();
  }
  const brands = new Set<string>();
  for (let offset = 8; offset + 4 <= value.length; offset += 4) {
    brands.add(value.toString("ascii", offset, offset + 4));
  }
  return brands;
}

function contentMatchesMimeType(value: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return hasPrefix(value, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/png") {
    return hasPrefix(value, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/webp") {
    return value.length >= 12
      && value.toString("ascii", 0, 4) === "RIFF"
      && value.toString("ascii", 8, 12) === "WEBP";
  }
  const brands = isoBaseMediaBrands(value);
  const heicBrands = ["heic", "heix", "hevc", "hevx", "heim", "heis"];
  if (mimeType === "image/heic") {
    return heicBrands.some((brand) => brands.has(brand));
  }
  if (mimeType === "image/heif") {
    return [...heicBrands, "heif", "mif1", "msf1"].some((brand) => brands.has(brand));
  }
  return false;
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value !== undefined) {
          await work(value);
        }
      }
    },
  );
  await Promise.all(workers);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return Number(Reflect.get(error, "code")) === 404;
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return Number(Reflect.get(error, "code")) === 409;
}

function encodedPath(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function createGcsCompanyFileObjectStore(
  options: Omit<CreateCompanyFileStorageOptions, "objectStore" | "now">,
): CompanyFileObjectStore {
  validateBucketId(options.bucketId);
  validatePublicBaseUrl(options.publicBaseUrl);
  const storage = new Storage({
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    ...(options.apiEndpoint === undefined ? {} : { apiEndpoint: options.apiEndpoint }),
  });
  const bucket = storage.bucket(options.bucketId);

  return {
    async checkReadiness() {
      try {
        await bucket.getMetadata();
      } catch (error) {
        if (options.publicBaseUrl === undefined || !isNotFound(error)) throw error;
        try {
          await storage.createBucket(options.bucketId);
        } catch (createError) {
          if (!isAlreadyExists(createError)) throw createError;
        }
        await bucket.getMetadata();
      }
    },

    async createSignedUploadUrl(input) {
      if (options.publicBaseUrl !== undefined) {
        const localUrl = new URL(
          `${encodeURIComponent(options.bucketId)}/${encodedPath(input.objectPath)}`,
          options.publicBaseUrl,
        );
        localUrl.searchParams.set("ifGenerationMatch", "0");
        return localUrl.href;
      }
      const [url] = await bucket.file(input.objectPath).getSignedUrl({
        version: "v4",
        action: "write",
        expires: input.expiresAt,
        contentType: input.contentType,
        queryParams: { ifGenerationMatch: "0" },
      });
      return url;
    },

    async getMetadata(objectPath) {
      try {
        const [metadata] = await bucket.file(objectPath).getMetadata();
        const sizeBytes = Number(metadata.size);
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
          throw new Error("GCS returned an invalid object size");
        }
        return {
          sizeBytes,
          contentType: String(metadata.contentType ?? ""),
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    createReadStream(objectPath) {
      return bucket.file(objectPath).createReadStream();
    },

    async createSignedDownloadUrl(input) {
      if (options.publicBaseUrl !== undefined) {
        return new URL(
          `${encodeURIComponent(options.bucketId)}/${encodedPath(input.objectPath)}`,
          options.publicBaseUrl,
        ).href;
      }
      const [url] = await bucket.file(input.objectPath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: input.expiresAt,
      });
      return url;
    },

    async removeObject(objectPath) {
      await bucket.file(objectPath).delete({ ignoreNotFound: true });
    },
  };
}

export function createCompanyFileStorage(
  options: CreateCompanyFileStorageOptions,
): CompanyFileStorage {
  validateBucketId(options.bucketId);
  const now = options.now ?? Date.now;
  const objectStore = options.objectStore ?? createGcsCompanyFileObjectStore(options);

  const verifyOne = async (attachment: StoredUploadAttachment): Promise<void> => {
    const objectPath = normalizedObjectPath(attachment.objectPath);
    let metadata: CompanyFileObjectMetadata | null;
    try {
      metadata = await objectStore.getMetadata(objectPath);
    } catch (error) {
      throw storageUnavailable(error);
    }
    if (metadata === null) {
      throw objectNotReady(new Error("Storage object was not found"));
    }
    if (metadata.sizeBytes !== attachment.sizeBytes) {
      throw invalidUpload("An uploaded file has an unexpected size.");
    }
    const actualMimeType = metadata.contentType
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
    if (actualMimeType !== attachment.mimeType.toLowerCase()) {
      throw invalidUpload("An uploaded file has an unexpected content type.");
    }

    const digest = createHash("sha256");
    const sniffed = Buffer.alloc(MIME_SNIFF_BYTES);
    let sniffedBytes = 0;
    let receivedBytes = 0;
    try {
      for await (const chunk of objectStore.createReadStream(objectPath)) {
        const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += source.byteLength;
        if (receivedBytes > attachment.sizeBytes) {
          throw invalidUpload("An uploaded file has an unexpected size.");
        }
        if (sniffedBytes < sniffed.length) {
          sniffedBytes += source.copy(
            sniffed,
            sniffedBytes,
            0,
            Math.min(source.length, sniffed.length - sniffedBytes),
          );
        }
        digest.update(source);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isNotFound(error)) throw objectNotReady(error);
      throw storageUnavailable(error);
    }

    if (receivedBytes !== attachment.sizeBytes) {
      throw invalidUpload("An uploaded file has an unexpected size.");
    }
    if (!contentMatchesMimeType(sniffed.subarray(0, sniffedBytes), actualMimeType)) {
      throw invalidUpload("An uploaded file does not match its declared content type.");
    }
    if (!equalHex(digest.digest("hex"), attachment.sha256.toLowerCase())) {
      throw invalidUpload("An uploaded file failed integrity verification.");
    }
  };

  return {
    async checkReadiness() {
      try {
        await objectStore.checkReadiness();
      } catch (error) {
        throw storageUnavailable(error);
      }
    },

    async createSignedUploadTargets(attachments) {
      return Promise.all(attachments.map(async (attachment) => {
        const objectPath = normalizedObjectPath(attachment.objectPath);
        let uploadUrl: string;
        try {
          uploadUrl = await objectStore.createSignedUploadUrl({
            objectPath,
            contentType: attachment.mimeType,
            expiresAt: now() + SIGNED_UPLOAD_EXPIRY_MS,
          });
          new URL(uploadUrl);
        } catch (error) {
          throw storageUnavailable(error);
        }
        return SignedUploadTargetSchema.parse({
          ...attachment,
          objectPath,
          uploadUrl,
          requiredHeaders: {
            "cache-control": "private, max-age=3600",
            "content-type": attachment.mimeType,
          },
        });
      }));
    },

    verifyUploadedAttachments(attachments) {
      return mapWithConcurrency(attachments, VERIFY_CONCURRENCY, verifyOne);
    },

    async createSignedDownloadUrl(rawObjectPath, expiresInSeconds) {
      const objectPath = normalizedObjectPath(rawObjectPath);
      if (
        !Number.isInteger(expiresInSeconds)
        || expiresInSeconds < 60
        || expiresInSeconds > 60 * 60
      ) {
        throw new TypeError("Signed download expiry must be between 60 seconds and one hour");
      }
      try {
        const signedUrl = await objectStore.createSignedDownloadUrl({
          objectPath,
          expiresAt: now() + expiresInSeconds * 1_000,
        });
        return new URL(signedUrl).href;
      } catch (error) {
        throw storageUnavailable(error);
      }
    },

    async removeObjects(objectPaths) {
      try {
        await mapWithConcurrency(
          objectPaths.map(normalizedObjectPath),
          VERIFY_CONCURRENCY,
          (objectPath) => objectStore.removeObject(objectPath),
        );
      } catch (error) {
        throw storageUnavailable(error);
      }
    },
  };
}
