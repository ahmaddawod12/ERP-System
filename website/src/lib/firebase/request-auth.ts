import type { VerifiedAccessToken } from "@/lib/auth/access-token";
import { parseBearerToken, verifyAccessToken } from "@/lib/auth/access-token";
import { extractCookieValue } from "@/lib/auth/session-middleware";
import { SESSION_COOKIE, verifySessionCookieValue } from "@/lib/auth/session-token";
import { ApiRouteError } from "@/lib/api/errors";

export interface RequestAuthResult {
  uid: string;
  token: VerifiedAccessToken | null;
  source: "token" | "session";
  provider: "supabase";
}

export async function resolveRequestAuth(
  request: Request,
): Promise<RequestAuthResult> {
  const token = parseBearerToken(request.headers.get("authorization"));

  if (token) {
    const verifiedToken = await verifyAccessToken(token);
    return {
      uid: verifiedToken.uid,
      token: verifiedToken,
      source: "token",
      provider: verifiedToken.provider,
    };
  }

  const sessionCookie = extractCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (sessionCookie) {
    const sessionPayload = await verifySessionCookieValue(sessionCookie);
    if (sessionPayload?.uid && sessionPayload.accessToken) {
      const verifiedToken = await verifyAccessToken(sessionPayload.accessToken);
      return {
        uid: verifiedToken.uid,
        token: verifiedToken,
        source: "session",
        provider: verifiedToken.provider,
      };
    }
  }

  throw new ApiRouteError(
    401,
    "unauthorized",
    "Missing authenticated session",
  );
}
