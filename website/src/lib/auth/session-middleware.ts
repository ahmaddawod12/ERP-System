const SESSION_COOKIE = "__session";

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
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const token = extractCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) {
    return false;
  }

  try {
    const verificationUrl = new URL("/api/auth/session", requestUrl);
    const response = await fetchImpl(verificationUrl, {
      method: "GET",
      headers: {
        cookie: cookieHeader || "",
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}