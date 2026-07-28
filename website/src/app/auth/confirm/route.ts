import { NextResponse } from "next/server.js";

import { parseWebsiteOrigin } from "@/lib/auth/opaque-session";
import {
  createRecoveryCsrfToken,
  DEVELOPMENT_RECOVERY_COOKIE,
  PRODUCTION_RECOVERY_COOKIE,
  RECOVERY_CSRF_COOKIE,
  RECOVERY_MAX_AGE_SECONDS,
  recoveryCookieName,
  sealRecoveryCredential,
} from "@/lib/auth/password-recovery";
import {
  serverConfirmEmail,
  serverVerifyPasswordResetCode,
} from "@/lib/auth/server-firebase";
import { isVerifiedLocalPlatformRuntime } from "@/lib/local-platform";

export const runtime = "nodejs";

function redirectResponse(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function clearRecoveryCookies(response: NextResponse): void {
  const secure = process.env.NODE_ENV === "production" && !isVerifiedLocalPlatformRuntime();
  for (const name of new Set([
    recoveryCookieName(),
    PRODUCTION_RECOVERY_COOKIE,
    DEVELOPMENT_RECOVERY_COOKIE,
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
  response.cookies.set(RECOVERY_CSRF_COOKIE, "", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function GET(request: Request) {
  const origin = parseWebsiteOrigin(
    String(process.env.WEBSITE_ORIGIN || ""),
    process.env.NODE_ENV,
  );
  const requestUrl = new URL(request.url);
  const actionCode = requestUrl.searchParams.get("oobCode")?.trim() ?? "";
  const mode = requestUrl.searchParams.get("mode");
  if (
    !actionCode
    || actionCode.length > 4_096
    || (mode !== "verifyEmail" && mode !== "resetPassword")
  ) {
    return redirectResponse(
      origin,
      mode === "resetPassword"
        ? "/forgot-password?error=invalid_link"
        : "/login?error=confirmation_failed",
    );
  }

  try {
    if (mode === "verifyEmail") {
      await serverConfirmEmail(actionCode);
      return redirectResponse(origin, "/login?verified=1");
    }

    await serverVerifyPasswordResetCode(actionCode);
    const nowMs = Date.now();
    const sealed = sealRecoveryCredential(
      {
        actionCode,
        expiresAt: nowMs + (RECOVERY_MAX_AGE_SECONDS * 1_000),
      },
      String(process.env.WEBSITE_SESSION_SECRET || ""),
      nowMs,
    );
    const csrfToken = createRecoveryCsrfToken();
    const response = redirectResponse(origin, "/reset-password");
    clearRecoveryCookies(response);
    const secure = process.env.NODE_ENV === "production" && !isVerifiedLocalPlatformRuntime();
    const expires = new Date(nowMs + (RECOVERY_MAX_AGE_SECONDS * 1_000));
    response.cookies.set(recoveryCookieName(), sealed, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_MAX_AGE_SECONDS,
      expires,
    });
    response.cookies.set(RECOVERY_CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_MAX_AGE_SECONDS,
      expires,
    });
    return response;
  } catch {
    const response = redirectResponse(
      origin,
      mode === "resetPassword"
        ? "/forgot-password?error=invalid_link"
        : "/login?error=confirmation_failed",
    );
    clearRecoveryCookies(response);
    return response;
  }
}
