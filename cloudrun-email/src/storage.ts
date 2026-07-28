import { Storage } from "@google-cloud/storage";

import type { EmailWorkerConfig } from "./config.js";

export interface DocumentDownloadUrlSigner {
  sign(objectPath: string, expiresAt: number): Promise<string>;
}

function normalizedObjectPath(value: string): string {
  const objectPath = value.trim();
  const segments = objectPath.split("/");
  if (
    !objectPath
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
    throw new TypeError("Document object path is invalid");
  }
  return objectPath;
}

function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function checkStorageConfiguration(config: EmailWorkerConfig["storage"]): void {
  if (
    !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(config.bucket)
    || !Number.isInteger(config.signedUrlTtlSeconds)
    || config.signedUrlTtlSeconds < 300
  ) {
    throw new Error("Email storage configuration is unavailable");
  }
}

export function createGcsDocumentUrlSigner(
  config: EmailWorkerConfig["storage"],
): DocumentDownloadUrlSigner {
  checkStorageConfiguration(config);
  const storage = new Storage({
    ...(config.projectId === undefined ? {} : { projectId: config.projectId }),
    ...(config.apiEndpoint === undefined ? {} : { apiEndpoint: config.apiEndpoint }),
  });
  const bucket = storage.bucket(config.bucket);

  return {
    async sign(objectPath, expiresAt) {
      if (config.publicBaseUrl !== undefined) {
        return new URL(
          `${encodeURIComponent(config.bucket)}/${encodeObjectPath(objectPath)}`,
          config.publicBaseUrl,
        ).href;
      }
      const [url] = await bucket.file(objectPath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });
      return url;
    },
  };
}

export async function createDocumentDownloadUrl(
  config: EmailWorkerConfig["storage"],
  rawObjectPath: string,
  signer: DocumentDownloadUrlSigner = createGcsDocumentUrlSigner(config),
): Promise<string> {
  checkStorageConfiguration(config);
  const objectPath = normalizedObjectPath(rawObjectPath);
  const signedUrl = new URL(
    await signer.sign(
      objectPath,
      Date.now() + config.signedUrlTtlSeconds * 1_000,
    ),
  );
  if (!["http:", "https:"].includes(signedUrl.protocol) || signedUrl.hash) {
    throw new Error("Storage signing returned an unexpected URL");
  }
  return signedUrl.href;
}
