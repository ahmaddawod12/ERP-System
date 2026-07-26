import { createHash } from "node:crypto";

import { z } from "zod";

import { AppError } from "../http/errors.js";

const metadataTokenSchema = z.object({
  access_token: z.string().trim().min(20),
  expires_in: z.number().int().positive(),
  token_type: z.string().trim().min(1),
}).passthrough();

const DEFAULT_METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const DEFAULT_GCS_API_BASE_URL = "https://storage.googleapis.com";
const ARCHIVE_READ_TIMEOUT_MS = 12_000;
const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;

export interface ArchiveContent {
  readonly items: readonly Record<string, unknown>[];
}

export interface ArchiveStorage {
  checkReadiness?(): Promise<void>;
  readVerifiedArchiveJsonByPath(
    companyStorageId: string,
    objectPath: string,
    storageGeneration: string,
    checksum: string,
  ): Promise<ArchiveContent | null>;
}

export interface CreateArchiveStorageOptions {
  readonly bucket: string;
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly metadataTokenUrl?: string;
  readonly gcsApiBaseUrl?: string;
}

interface CachedAccessToken {
  readonly value: string;
  readonly refreshAt: number;
}

function requireCompanyArchiveObjectPath(
  companyStorageId: string,
  rawObjectPath: string,
): string {
  const normalizedCompanyId = companyStorageId.trim();
  const objectPath = rawObjectPath.trim();
  const expectedPrefix = `companies/${normalizedCompanyId}/archives/`;
  if (
    !/^(?:[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(normalizedCompanyId)
    || !objectPath.startsWith(expectedPrefix)
    || !objectPath.endsWith(".json")
    || objectPath.includes("..")
    || objectPath.includes("//")
    || objectPath.includes("?")
    || objectPath.includes("#")
  ) {
    throw new AppError({
      statusCode: 409,
      code: "ARCHIVE_FILE_INVALID",
      message: "The archive file is unavailable.",
    });
  }
  const fileName = objectPath.slice(expectedPrefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(fileName)) {
    throw new AppError({
      statusCode: 409,
      code: "ARCHIVE_FILE_INVALID",
      message: "The archive file is unavailable.",
    });
  }
  return objectPath;
}

export function createArchiveStorage(options: CreateArchiveStorageOptions): ArchiveStorage {
  const fetchImpl = options.fetchImplementation ?? globalThis.fetch;
  const metadataUrl = options.metadataTokenUrl ?? DEFAULT_METADATA_TOKEN_URL;
  const gcsBase = options.gcsApiBaseUrl ?? DEFAULT_GCS_API_BASE_URL;
  let cachedToken: CachedAccessToken | undefined;
  let inflightToken: Promise<string> | undefined;

  async function getAccessToken(): Promise<string> {
    if (cachedToken !== undefined && cachedToken.refreshAt > Date.now()) {
      return cachedToken.value;
    }
    if (inflightToken !== undefined) return inflightToken;
    inflightToken = (async () => {
      const response = await fetchImpl(metadataUrl, {
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        throw new AppError({
          statusCode: 503,
          code: "ARCHIVE_CREDENTIALS_UNAVAILABLE",
          message: "Archive retrieval credentials are not configured.",
          retryable: true,
        });
      }
      const parsed = metadataTokenSchema.parse(await response.json());
      cachedToken = {
        value: parsed.access_token,
        refreshAt: Date.now() + Math.min(parsed.expires_in - 60, 1800) * 1000,
      };
      return parsed.access_token;
    })().finally(() => {
      inflightToken = undefined;
    });
    return inflightToken;
  }

  async function readObject(
    objectPath: string,
    storageGeneration: string,
    expectedChecksum: string,
  ): Promise<ArchiveContent | null> {
    if (!/^[1-9][0-9]*$/.test(storageGeneration)) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The archive ledger contains an invalid object generation.",
      });
    }
    if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The archive ledger contains an invalid checksum.",
      });
    }
    const encodedObject = encodeURIComponent(objectPath);
    const url = new URL(
      `${gcsBase}/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodedObject}`,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("generation", storageGeneration);
    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(ARCHIVE_READ_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new AppError({
        statusCode: 503,
        code: "ARCHIVE_READ_FAILED",
        message: "Archive retrieval timed out or lost connectivity.",
        retryable: true,
        cause,
      });
    }
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) {
      throw new AppError({
        statusCode: 503,
        code: "ARCHIVE_OBJECT_UNAVAILABLE",
        message: "The exact archived object is temporarily unavailable.",
        retryable: true,
      });
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > ARCHIVE_MAX_BYTES) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The archived object exceeds the verified segment limit.",
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > ARCHIVE_MAX_BYTES) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The archived object exceeds the verified segment limit.",
      });
    }
    const actualChecksum = createHash("sha256").update(bytes).digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The archived object does not match its integrity ledger.",
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The verified archived object is not valid JSON.",
        cause,
      });
    }
    if (!Array.isArray(payload)) {
      throw new AppError({
        statusCode: 409,
        code: "ARCHIVE_INTEGRITY_FAILURE",
        message: "The verified archived object has an invalid shape.",
      });
    }
    return { items: payload as Record<string, unknown>[] };
  }

  return {
    async checkReadiness() {
      const token = await getAccessToken();
      const response = await fetchImpl(
        `${gcsBase}/storage/v1/b/${encodeURIComponent(options.bucket)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`Archive bucket readiness failed (${response.status})`);
    },

    readVerifiedArchiveJsonByPath(
      companyStorageId,
      rawObjectPath,
      storageGeneration,
      checksum,
    ) {
      return readObject(
        requireCompanyArchiveObjectPath(companyStorageId, rawObjectPath),
        storageGeneration,
        checksum,
      );
    },
  };
}
