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

export interface ArchiveContent {
  readonly items: readonly Record<string, unknown>[];
}

export interface ArchiveStorage {
  readArchiveJson(
    internalCompanyId: string,
    archiveKey: string,
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

function archiveObjectPath(internalCompanyId: string, archiveKey: string): string {
  return `companies/${internalCompanyId}/archives/${archiveKey}.json`;
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

  return {
    async readArchiveJson(internalCompanyId, archiveKey) {
      const objectPath = archiveObjectPath(internalCompanyId, archiveKey);
      const encodedObject = encodeURIComponent(objectPath);
      const url = `${gcsBase}/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodedObject}?alt=media`;
      const token = await getAccessToken();
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new AppError({
          statusCode: 503,
          code: "ARCHIVE_READ_FAILED",
          message: `Archive month retrieval failed (${response.status}).`,
          retryable: true,
        });
      }
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload)) return null;
      return { items: payload as Record<string, unknown>[] };
    },
  };
}
