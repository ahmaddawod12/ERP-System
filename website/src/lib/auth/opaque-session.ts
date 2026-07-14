import type { NextResponse } from "next/server";
import {
  WebSessionCsrfTokenSchema,
  WebSessionTokenSchema,
  type WebSessionCsrfToken,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { SESSION_ACCESS_TOKEN_COOKIE, SESSION_COOKIE } from "./session-token.ts";

export const PRODUCTION_WEB_SESSION_COOKIE = "__Host-sj_web_session";
export const DEVELOPMENT_WEB_SESSION_COOKIE = "sj_web_session";
export const WEB_CSRF_COOKIE = "sj_csrf";
export const WEB_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function webSessionCookieName(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  return nodeEnv === "production"
    ? PRODUCTION_WEB_SESSION_COOKIE
    : DEVELOPMENT_WEB_SESSION_COOKIE;
}

export function parseWebsiteOrigin(
  rawValue: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
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
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    throw new Error("WEBSITE_ORIGIN must use HTTPS in production");
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
  options: { nodeEnv?: string; nowMs?: number } = {},
): void {
  if (!isOpaqueSessionToken(values.sessionToken) || !isCsrfToken(values.csrfToken)) {
    throw new Error("The backend returned invalid web-session credentials");
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const nowMs = options.nowMs ?? Date.now();
  const maxAge = sessionLifetimeSeconds(values.absoluteExpiresAt, nowMs);
  const expires = new Date(nowMs + (maxAge * 1_000));
  const secure = nodeEnv === "production";
  response.cookies.set(webSessionCookieName(nodeEnv), values.sessionToken, {
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
  clearLegacySessionCookies(response, nodeEnv);
}

function clearLegacySessionCookies(
  response: NextResponse,
  nodeEnv: string | undefined,
): void {
  const secure = nodeEnv === "production";
  for (const name of [SESSION_COOKIE, SESSION_ACCESS_TOKEN_COOKIE]) {
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
  const secure = nodeEnv === "production";
  for (const name of new Set([
    webSessionCookieName(nodeEnv),
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
  clearLegacySessionCookies(response, nodeEnv);
}
