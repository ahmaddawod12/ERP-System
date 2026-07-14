import { createHash, timingSafeEqual } from "node:crypto";

import {
  SignedUploadTargetSchema,
  type SignedUploadTarget,
  type UploadAttachmentManifest,
} from "@smart-job/api-contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../http/errors.js";

const STORAGE_REQUEST_TIMEOUT_MS = 10_000;
const VERIFY_CONCURRENCY = 4;
const MIME_SNIFF_BYTES = 32;

export interface StoredUploadAttachment extends UploadAttachmentManifest {
  readonly objectPath: string;
}

export interface CompanyFileStorage {
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

export interface CreateCompanyFileStorageOptions {
  readonly baseUrl: URL;
  readonly secretKey: string;
  readonly bucketId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly client?: SupabaseClient;
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

function storageStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { statusCode?: unknown }).statusCode;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function encodedObjectPath(bucketId: string, objectPath: string): string {
  return [bucketId, ...objectPath.split("/")]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

export function createCompanyFileStorage(
  options: CreateCompanyFileStorageOptions,
): CompanyFileStorage {
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) {
    throw new TypeError("A Supabase secret key is required for company storage");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const client = options.client ?? createClient(
    options.baseUrl.href,
    options.secretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: fetchImplementation },
    },
  );
  const bucket = client.storage.from(options.bucketId);

  const verifyOne = async (attachment: StoredUploadAttachment): Promise<void> => {
    let info: Awaited<ReturnType<typeof bucket.info>>;
    try {
      info = await bucket.info(attachment.objectPath);
    } catch (error) {
      throw storageUnavailable(error);
    }
    if (info.error) {
      if (storageStatus(info.error) === 404) {
        throw objectNotReady(info.error);
      }
      throw storageUnavailable(info.error);
    }

    if (info.data.size !== attachment.sizeBytes) {
      throw invalidUpload("An uploaded file has an unexpected size.");
    }
    const actualMimeType = String(info.data.contentType ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (actualMimeType !== attachment.mimeType.toLowerCase()) {
      throw invalidUpload("An uploaded file has an unexpected content type.");
    }

    const endpoint = new URL(
      `storage/v1/object/authenticated/${encodedObjectPath(
        options.bucketId,
        attachment.objectPath,
      )}`,
      `${options.baseUrl.href.replace(/\/+$/, "")}/`,
    );
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "GET",
        headers: {
          accept: attachment.mimeType,
          apikey: options.secretKey,
        },
        redirect: "error",
        signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw storageUnavailable(error);
    }
    if (response.status === 404) {
      throw objectNotReady(new Error("Storage object was not found"));
    }
    if (!response.ok || !response.body) {
      throw storageUnavailable(new Error(`Storage download returned ${response.status}`));
    }

    const digest = createHash("sha256");
    const sniffed = Buffer.alloc(MIME_SNIFF_BYTES);
    let sniffedBytes = 0;
    let receivedBytes = 0;
    try {
      for await (const chunk of response.body) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > attachment.sizeBytes) {
          throw invalidUpload("An uploaded file has an unexpected size.");
        }
        if (sniffedBytes < sniffed.length) {
          const source = Buffer.from(chunk);
          const copied = source.copy(
            sniffed,
            sniffedBytes,
            0,
            Math.min(source.length, sniffed.length - sniffedBytes),
          );
          sniffedBytes += copied;
        }
        digest.update(chunk);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
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
    async createSignedUploadTargets(attachments) {
      return Promise.all(attachments.map(async (attachment) => {
        let signed: Awaited<ReturnType<typeof bucket.createSignedUploadUrl>>;
        try {
          signed = await bucket.createSignedUploadUrl(
            attachment.objectPath,
            { upsert: false },
          );
        } catch (error) {
          throw storageUnavailable(error);
        }
        if (signed.error) {
          throw storageUnavailable(signed.error);
        }
        let uploadUrl: URL;
        try {
          uploadUrl = new URL(signed.data.signedUrl);
        } catch (error) {
          throw storageUnavailable(error);
        }
        const expectedPath = `/storage/v1/object/upload/sign/${encodedObjectPath(
          options.bucketId,
          attachment.objectPath,
        )}`;
        if (
          uploadUrl.origin !== options.baseUrl.origin
          || uploadUrl.pathname !== expectedPath
          || !uploadUrl.searchParams.get("token")
        ) {
          throw storageUnavailable(new Error("Storage returned an invalid signed upload URL"));
        }
        return SignedUploadTargetSchema.parse({
          ...attachment,
          uploadUrl: uploadUrl.href,
          requiredHeaders: {
            "cache-control": "max-age=3600",
            "content-type": attachment.mimeType,
            "x-upsert": "false",
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
      let signed: Awaited<ReturnType<typeof bucket.createSignedUrl>>;
      try {
        signed = await bucket.createSignedUrl(objectPath, expiresInSeconds);
      } catch (error) {
        throw storageUnavailable(error);
      }
      if (signed.error || !signed.data?.signedUrl) {
        throw storageUnavailable(signed.error);
      }
      let signedUrl: URL;
      try {
        signedUrl = new URL(signed.data.signedUrl, options.baseUrl);
      } catch (error) {
        throw storageUnavailable(error);
      }
      const expectedPath = `/storage/v1/object/sign/${encodedObjectPath(
        options.bucketId,
        objectPath,
      )}`;
      if (
        signedUrl.origin !== options.baseUrl.origin
        || signedUrl.pathname !== expectedPath
        || !signedUrl.searchParams.get("token")
      ) {
        throw storageUnavailable(new Error("Storage returned an invalid signed download URL"));
      }
      return signedUrl.href;
    },

    async removeObjects(objectPaths) {
      if (objectPaths.length === 0) return;
      let result: Awaited<ReturnType<typeof bucket.remove>>;
      try {
        result = await bucket.remove([...objectPaths]);
      } catch (error) {
        throw storageUnavailable(error);
      }
      if (result.error) {
        throw storageUnavailable(result.error);
      }
    },
  };
}
