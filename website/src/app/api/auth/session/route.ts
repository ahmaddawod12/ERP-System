import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { extractCookieValue } from "@/lib/auth/session-middleware";

const SESSION_COOKIE = "__session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("firebase-auth-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  try {
    await adminAuth().verifyIdToken(token, true);
  } catch {
    const response = NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.set("firebase-auth-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const token = extractCookieValue(request.headers.get("cookie"), SESSION_COOKIE) || "";
  if (!token) {
    const response = NextResponse.json({ ok: false, error: "missing_session" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  try {
    await adminAuth().verifyIdToken(token, true);
  } catch {
    const response = NextResponse.json({ ok: false, error: "invalid_session" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
