import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildLoginRedirectUrl,
  hasValidRevocationCheckedSession,
} from "@/lib/auth/session-middleware";
import {
  isOpaqueSessionToken,
  webSessionCookieName,
} from "@/lib/auth/opaque-session";
import { SESSION_ACCESS_TOKEN_COOKIE, SESSION_COOKIE } from "@/lib/auth/session-token";
import { isOpaqueSessionAppRoute } from "@/lib/dal/workspace-routing";

function clearLegacySessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(SESSION_ACCESS_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }

  if (isOpaqueSessionAppRoute(request.nextUrl.pathname)) {
    const opaqueToken = request.cookies.get(webSessionCookieName())?.value ?? null;
    if (isOpaqueSessionToken(opaqueToken)) {
      // This is only an optimistic format check. The server DAL/API performs
      // definitive session and tenant authorization before rendering.
      return NextResponse.next();
    }

    return NextResponse.redirect(
      buildLoginRedirectUrl(
        request.url,
        request.nextUrl.pathname,
        request.nextUrl.search,
      ),
    );
  }

  // Transitional legacy routes keep their existing revocation check until
  // their vertical slices move under /app/c/{companyId}.
  const hasValidToken = await hasValidRevocationCheckedSession(
    request.url,
    request.headers.get("cookie"),
  );

  if (!hasValidToken) {
    const response = NextResponse.redirect(
      buildLoginRedirectUrl(
        request.url,
        request.nextUrl.pathname,
        request.nextUrl.search,
      ),
    );
    clearLegacySessionCookies(response);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
