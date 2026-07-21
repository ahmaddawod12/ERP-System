import type { NextResponse } from "next/server";
import {
  WebSessionCsrfTokenSchema,
  WebSessionTokenSchema,
  type WebSessionCsrfToken,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { isVerifiedLocalPlatformRuntime } from "../local-platform.ts";

export const PRODUCTION_WEB_SESSION_COOKIE = "__Host-sj_web_session";
export const DEVELOPMENT_WEB_SESSION_COOKIE = "sj_web_session";
export const WEB_CSRF_COOKIE = "sj_csrf";
export const WEB_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const LEGACY_SESSION_COOKIE = "__session";
const LEGACY_SESSION_ACCESS_COOKIE = "__session_access";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function webSessionCookieName(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  verifiedLocalPlatform = isVerifiedLocalPlatformRuntime(),
): string {
  return nodeEnv === "production" && !verifiedLocalPlatform
    ? PRODUCTION_WEB_SESSION_COOKIE
    : DEVELOPMENT_WEB_SESSION_COOKIE;
}

export function parseWebsiteOrigin(
  rawValue: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  verifiedLocalPlatform = isVerifiedLocalPlatformRuntime(),
): string {
  const raw = rawValue.trim();
  if (!raw) {
    throw new Error("WEBSITE_ORIGIN is required for website mutations");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("WEBSITE_ORIGIN must be an absolute URL");
  }

  if (
    parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("WEBSITE_ORIGIN must contain only a scheme and host");
  }

  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error("WEBSITE_ORIGIN must use HTTPS (HTTP is allowed only for loopback development)");
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:" && !verifiedLocalPlatform) {
    throw new Error("WEBSITE_ORIGIN must use HTTPS in production");
  }
  if (verifiedLocalPlatform && parsed.protocol === "http:" && !isLoopback) {
    throw new Error("Local WEBSITE_ORIGIN HTTP must remain on loopback");
  }

  return parsed.origin;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  for (const entry of cookieHeader.split(";")) {
    const candidate = entry.trim();
    if (!candidate.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(candidate.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

export function isOpaqueSessionToken(value: string | null): value is WebSessionToken {
  return WebSessionTokenSchema.safeParse(value).success;
}

export function isCsrfToken(value: string | null): value is WebSessionCsrfToken {
  return WebSessionCsrfTokenSchema.safeParse(value).success;
}

export function sessionLifetimeSeconds(absoluteExpiresAt: string, nowMs = Date.now()): number {
  const expiryMs = Date.parse(absoluteExpiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
    throw new Error("The backend returned an expired web session");
  }
  return Math.min(
    WEB_SESSION_MAX_AGE_SECONDS,
    Math.max(1, Math.floor((expiryMs - nowMs) / 1_000)),
  );
}

export function setOpaqueSessionCookies(
  response: NextResponse,
  values: { sessionToken: string; csrfToken: string; absoluteExpiresAt: string },
  options: { nodeEnv?: string; nowMs?: number; verifiedLocalPlatform?: boolean } = {},
): void {
  if (!isOpaqueSessionToken(values.sessionToken) || !isCsrfToken(values.csrfToken)) {
    throw new Error("The backend returned invalid web-session credentials");
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const verifiedLocalPlatform = options.verifiedLocalPlatform
    ?? isVerifiedLocalPlatformRuntime();
  const nowMs = options.nowMs ?? Date.now();
  const maxAge = sessionLifetimeSeconds(values.absoluteExpiresAt, nowMs);
  const expires = new Date(nowMs + (maxAge * 1_000));
  const secure = nodeEnv === "production" && !verifiedLocalPlatform;
  response.cookies.set(webSessionCookieName(nodeEnv, verifiedLocalPlatform), values.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
    expires,
  });
  response.cookies.set(WEB_CSRF_COOKIE, values.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
    expires,
  });
  clearLegacySessionCookies(response, nodeEnv, verifiedLocalPlatform);
}

function clearLegacySessionCookies(
  response: NextResponse,
  nodeEnv: string | undefined,
  verifiedLocalPlatform = isVerifiedLocalPlatformRuntime(),
): void {
  const secure = nodeEnv === "production" && !verifiedLocalPlatform;
  for (const name of [LEGACY_SESSION_COOKIE, LEGACY_SESSION_ACCESS_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
}

export function clearOpaqueSessionCookies(
  response: NextResponse,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  const verifiedLocalPlatform = isVerifiedLocalPlatformRuntime();
  const secure = nodeEnv === "production" && !verifiedLocalPlatform;
  for (const name of new Set([
    webSessionCookieName(nodeEnv, verifiedLocalPlatform),
    PRODUCTION_WEB_SESSION_COOKIE,
    DEVELOPMENT_WEB_SESSION_COOKIE,
  ])) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: name.startsWith("__Host-") ? true : secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
  response.cookies.set(WEB_CSRF_COOKIE, "", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  clearLegacySessionCookies(response, nodeEnv, verifiedLocalPlatform);
}

export function buildLoginRedirectUrl(
  originalUrl: string,
  pathname: string,
  search: string,
): string {
  const loginUrl = new URL("/login", originalUrl);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return loginUrl.toString();
}
