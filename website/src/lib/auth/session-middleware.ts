import { SESSION_COOKIE, verifySessionCookieValue } from "./session-token.ts";

type SessionValidationFetch = typeof fetch;

const SESSION_VALIDATION_TTL_MS = 30_000;
const MAX_SESSION_VALIDATION_CACHE_ENTRIES = 256;
const sessionValidationCache = new Map<string, { valid: boolean; checkedAt: number }>();

function readCachedSessionValidation(token: string): boolean | null {
  const cached = sessionValidationCache.get(token);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > SESSION_VALIDATION_TTL_MS) {
    sessionValidationCache.delete(token);
    return null;
  }
  return cached.valid;
}

function writeCachedSessionValidation(token: string, valid: boolean) {
  if (sessionValidationCache.size >= MAX_SESSION_VALIDATION_CACHE_ENTRIES) {
    const firstKey = sessionValidationCache.keys().next().value;
    if (firstKey) {
      sessionValidationCache.delete(firstKey);
    }
  }
  sessionValidationCache.set(token, { valid, checkedAt: Date.now() });
}

export function extractCookieValue(cookieHeader: string | null, cookieName: string): string | null {
  const safeName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = (cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]+)`));
  if (!match) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

export function buildLoginRedirectUrl(requestUrl: string, pathname: string, search: string): string {
  const loginUrl = new URL("/login", requestUrl);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return loginUrl.toString();
}

export async function hasValidRevocationCheckedSession(
  requestUrl: string,
  cookieHeader: string | null,
  fetchImpl: SessionValidationFetch = fetch,
): Promise<boolean> {
  const token = extractCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) {
    return false;
  }

  if ((await verifySessionCookieValue(token)) === null) {
    return false;
  }

  const cachedValidation = readCachedSessionValidation(token);
  if (cachedValidation !== null) {
    return cachedValidation;
  }

  try {
    const sessionUrl = new URL("/api/auth/session", requestUrl);
    const response = await fetchImpl(sessionUrl.toString(), {
      method: "GET",
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      cache: "no-store",
    });
    writeCachedSessionValidation(token, response.ok);
    return response.ok;
  } catch {
    writeCachedSessionValidation(token, false);
    return false;
  }
}