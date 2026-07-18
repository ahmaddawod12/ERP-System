import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildLoginRedirectUrl } from "@/lib/auth/opaque-session";
import {
  isOpaqueSessionToken,
  webSessionCookieName,
} from "@/lib/auth/opaque-session";

export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }

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

export const config = {
  matcher: ["/app/:path*"],
};
