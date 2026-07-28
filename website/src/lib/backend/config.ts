import {
  hasLocalPlatformFlags,
  isVerifiedLocalPlatformRuntime,
} from "../local-platform.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_API_HOST = "cloudrun-api";

export interface BackendRuntimeConfig {
  baseUrl: string;
  timeoutMs: number;
}

export function parseBackendBaseUrl(
  rawValue: string,
  nodeEnv: string | undefined,
  verifiedLocalPlatform = false,
): string {
  const raw = rawValue.trim();
  if (!raw) {
    throw new Error("BACKEND_API_BASE_URL is required for the server-rendered website transport");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BACKEND_API_BASE_URL must be an absolute URL");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("BACKEND_API_BASE_URL must not contain credentials, a query, or a fragment");
  }
  if (parsed.pathname !== "/") {
    throw new Error("BACKEND_API_BASE_URL must not contain a path");
  }

  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  const isLocalService = verifiedLocalPlatform
    && parsed.protocol === "http:"
    && parsed.hostname === LOCAL_API_HOST
    && parsed.port === "8080";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback) && !isLocalService) {
    throw new Error("BACKEND_API_BASE_URL must use HTTPS (HTTP is allowed only for loopback development)");
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:" && !isLocalService) {
    throw new Error("BACKEND_API_BASE_URL must use HTTPS in production");
  }

  return parsed.origin;
}

export function loadBackendRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntimeConfig {
  const verifiedLocalPlatform = isVerifiedLocalPlatformRuntime(env);
  if (hasLocalPlatformFlags(env) && !verifiedLocalPlatform) {
    throw new Error("Local website overrides require the verified local-platform entrypoint");
  }
  const timeoutRaw = String(env.BACKEND_API_TIMEOUT_MS || "12000").trim();
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 12_000) {
    throw new Error("BACKEND_API_TIMEOUT_MS must be an integer between 1000 and 12000");
  }

  return {
    baseUrl: parseBackendBaseUrl(
      String(env.BACKEND_API_BASE_URL || ""),
      env.NODE_ENV,
      verifiedLocalPlatform,
    ),
    timeoutMs,
  };
}
