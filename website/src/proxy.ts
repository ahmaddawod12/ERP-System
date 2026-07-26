import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildLoginRedirectUrl } from "@/lib/auth/opaque-session";
import {
  isOpaqueSessionToken,
  webSessionCookieName,
} from "@/lib/auth/opaque-session";
import {
  buildSensitiveContentSecurityPolicy,
  isSensitiveCspPath,
} from "@/lib/security/content-security-policy";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAppRoute = pathname === "/app" || pathname.startsWith("/app/");
  const isSensitiveRoute = isSensitiveCspPath(pathname);
  if (!isSensitiveRoute) {
    return NextResponse.next();
  }

  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = buildSensitiveContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  let response: NextResponse;
  if (isAppRoute) {
    const opaqueToken =
      request.cookies.get(webSessionCookieName())?.value ?? null;
    if (!isOpaqueSessionToken(opaqueToken)) {
      response = NextResponse.redirect(
        buildLoginRedirectUrl(
          request.url,
          pathname,
          request.nextUrl.search,
        ),
      );
    } else {
      // This is only an optimistic format check. The server DAL/API performs
      // definitive session and tenant authorization before rendering.
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
