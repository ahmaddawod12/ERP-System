import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

function resolveProjectId(): string | null {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    null
  );
}

async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<boolean> {
  try {
    const issuer = `https://securetoken.google.com/${projectId}`;
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer,
      audience: projectId,
    });

    return typeof payload.sub === "string" && payload.sub.length > 0;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }

  const token = request.cookies.get("__session")?.value;
  const projectId = resolveProjectId();

  const hasValidToken =
    typeof token === "string" && typeof projectId === "string"
      ? await verifyFirebaseIdToken(token, projectId)
      : false;

  if (!hasValidToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "redirect",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
