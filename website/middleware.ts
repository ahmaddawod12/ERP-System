import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Validate that a string looks like a Firebase JWT (3 base64url segments).
 * This is a structural check, not a signature verification. Full verification
 * happens server-side in resolveRequestAuth() and client-side in ProtectedRoute.
 */
function isValidJwtFormat(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  // Each segment must be non-empty and contain only base64url chars
  return parts.every(
    (part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part),
  );
}

export function middleware(request: NextRequest) {
  const token =
    request.cookies.get("__session")?.value ||
    request.cookies.get("firebase-auth-token")?.value;

  // Validate that the token exists AND has a valid JWT structure.
  // This prevents bypassing the redirect with arbitrary cookie values.
  const hasValidToken = token && isValidJwtFormat(token);

  if (!hasValidToken && request.nextUrl.pathname.startsWith("/app")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
