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

export interface ArchiveContent {
  readonly items: readonly Record<string, unknown>[];
}

export interface ArchiveStorage {
  readArchiveJson(
    companyStorageId: string,
    archiveKey: string,
  ): Promise<ArchiveContent | null>;
  readArchiveJsonByPath(
    companyStorageId: string,
    objectPath: string,
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

function archiveObjectPath(companyStorageId: string, archiveKey: string): string {
  const normalizedKey = archiveKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(normalizedKey)) {
    throw new TypeError("Archive key is invalid");
  }
  return `companies/${companyStorageId}/archives/${normalizedKey}.json`;
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

  async function readObject(objectPath: string): Promise<ArchiveContent | null> {
    const encodedObject = encodeURIComponent(objectPath);
    const url = `${gcsBase}/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodedObject}?alt=media`;
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
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AppError({
        statusCode: 503,
        code: "ARCHIVE_READ_FAILED",
        message: `Archive retrieval failed (${response.status}).`,
        retryable: true,
      });
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) return null;
    return { items: payload as Record<string, unknown>[] };
  }

  return {
    readArchiveJson(companyStorageId, archiveKey) {
      return readObject(archiveObjectPath(companyStorageId, archiveKey));
    },

    readArchiveJsonByPath(companyStorageId, rawObjectPath) {
      return readObject(requireCompanyArchiveObjectPath(companyStorageId, rawObjectPath));
    },
  };
}
