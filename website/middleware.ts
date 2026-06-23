import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildLoginRedirectUrl,
  hasValidRevocationCheckedSession,
} from "@/lib/auth/session-middleware";
import { SESSION_ACCESS_TOKEN_COOKIE, SESSION_COOKIE } from "@/lib/auth/session-token";

function clearSessionCookie(response: NextResponse) {
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

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }

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
    clearSessionCookie(response);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
