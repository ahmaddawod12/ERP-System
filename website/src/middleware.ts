/**
 * I6: Next.js middleware for centralized auth redirect.
 * Protects all /app/* routes by checking for the Firebase session cookie.
 * Unauthenticated users are redirected to /login.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Check for Firebase auth session cookie
  const token =
    request.cookies.get("__session")?.value ||
    request.cookies.get("firebase-auth-token")?.value;

  if (!token && request.nextUrl.pathname.startsWith("/app")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
