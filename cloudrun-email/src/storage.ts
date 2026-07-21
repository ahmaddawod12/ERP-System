import type { EmailWorkerConfig } from "./config.js";

function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function createDocumentDownloadUrl(
  config: EmailWorkerConfig["storage"],
  objectPath: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const endpoint = new URL(
      `storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encodeObjectPath(objectPath)}`,
      config.baseUrl,
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: config.secretKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: config.signedUrlTtlSeconds }),
      signal: controller.signal,
    });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 64 * 1024) throw new Error("Storage signing response is too large");
    const payload: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new Error(`Storage signing failed with HTTP ${response.status}`);
    }
    const signedPath = String(
      (payload as { signedURL?: unknown; signedUrl?: unknown }).signedURL
        ?? (payload as { signedUrl?: unknown }).signedUrl
        ?? "",
    ).trim();
    if (!signedPath) throw new Error("Storage signing returned no URL");
    const signedUrl = new URL(signedPath, config.baseUrl);
    if (signedUrl.origin !== config.baseUrl.origin || !signedUrl.pathname.startsWith("/storage/v1/object/sign/")) {
      throw new Error("Storage signing returned an unexpected URL");
    }
    if (config.publicBaseUrl !== undefined) {
      return new URL(`${signedUrl.pathname}${signedUrl.search}`, config.publicBaseUrl).href;
    }
    return signedUrl.href;
  } finally {
    clearTimeout(timeout);
  }
}
