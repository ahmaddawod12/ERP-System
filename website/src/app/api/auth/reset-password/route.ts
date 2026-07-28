import { NextResponse } from "next/server.js";

import {
  parseWebsiteOrigin,
  readCookie,
} from "@/lib/auth/opaque-session";
import {
  DEVELOPMENT_RECOVERY_COOKIE,
  openRecoveryCredential,
  PRODUCTION_RECOVERY_COOKIE,
  RECOVERY_CSRF_COOKIE,
  recoveryCookieName,
  recoveryCsrfMatches,
} from "@/lib/auth/password-recovery";
import { isVerifiedLocalPlatformRuntime } from "@/lib/local-platform";
import {
  serverResetPassword,
} from "@/lib/auth/server-firebase";

export const runtime = "nodejs";

function json(payload: unknown, status: number): NextResponse {
  const response = NextResponse.json(payload, { status });
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

export async function POST(request: Request) {
  let expectedOrigin: string;
  try {
    expectedOrigin = parseWebsiteOrigin(
      String(process.env.WEBSITE_ORIGIN || ""),
      process.env.NODE_ENV,
    );
  } catch {
    return json({ ok: false, error: "Password recovery is not configured" }, 500);
  }
  if (request.headers.get("origin") !== expectedOrigin) {
    return json({ ok: false, error: "Request origin is not allowed" }, 403);
  }

  const cookieHeader = request.headers.get("cookie");
  const csrfCookie = readCookie(cookieHeader, RECOVERY_CSRF_COOKIE);
  const csrfHeader = request.headers.get("x-sj-recovery-csrf");
  if (!recoveryCsrfMatches(csrfCookie, csrfHeader)) {
    return json({ ok: false, error: "Recovery verification is missing or invalid" }, 403);
  }

  const sealed = readCookie(cookieHeader, recoveryCookieName());
  if (!sealed) {
    const response = json({ ok: false, error: "Reset link is missing or expired" }, 401);
    clearRecoveryCookies(response);
    return response;
  }

  let actionCode: string;
  try {
    actionCode = openRecoveryCredential(
      sealed,
      String(process.env.WEBSITE_SESSION_SECRET || ""),
    ).actionCode;
  } catch {
    const response = json({ ok: false, error: "Reset link is missing or expired" }, 401);
    clearRecoveryCookies(response);
    return response;
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 1_024) {
    return json({ ok: false, error: "Password must be between 8 and 1024 characters" }, 400);
  }

  try {
    await serverResetPassword(actionCode, password);
    const response = json({ ok: true }, 200);
    clearRecoveryCookies(response);
    return response;
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to reset password",
    }, 400);
  }
}
