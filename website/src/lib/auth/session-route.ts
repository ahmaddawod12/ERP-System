import { NextResponse } from "next/server.js";
import { parseBearerToken, verifyAccessToken, type VerifiedAccessToken } from "./access-token.ts";
import { extractCookieValue } from "./session-middleware.ts";
import {
  createSessionCookieValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionCookieValue,
  type WebsiteSessionPayload,
} from "./session-token.ts";

type UserRecordLike = {
  disabled?: boolean;
  tokensValidAfterTime?: string | null;
};

type SessionRouteDeps = {
  verifyAccessToken?: (token: string) => Promise<VerifiedAccessToken>;
  createSessionCookieValue?: typeof createSessionCookieValue;
  verifySessionCookieValue?: typeof verifySessionCookieValue;
  getUserByUid?: (uid: string) => Promise<UserRecordLike>;
};

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function normalizeSessionPayload(decodedToken: VerifiedAccessToken): WebsiteSessionPayload {
  return {
    uid: decodedToken.uid,
    provider: decodedToken.provider,
    email: decodedToken.email || null,
    role: typeof decodedToken.role === "string" ? decodedToken.role : null,
    companyId: typeof decodedToken.companyId === "string" ? decodedToken.companyId : null,
    authTime: Number.isFinite(decodedToken.authTime) ? Number(decodedToken.authTime) : null,
  };
}

function parseTokensValidAfterTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    return null;
  }

  return Math.floor(parsedMs / 1000);
}

async function validateSessionPayload(
  sessionPayload: WebsiteSessionPayload,
  getUserByUid?: (uid: string) => Promise<UserRecordLike>,
): Promise<boolean> {
  if (!sessionPayload.uid) {
    return false;
  }

  if (!getUserByUid) {
    return false;
  }

  if (!Number.isFinite(sessionPayload.authTime)) {
    return false;
  }

  try {
    const userRecord = await getUserByUid(sessionPayload.uid);
    if (userRecord?.disabled) {
      return false;
    }

    const validAfterSeconds = parseTokensValidAfterTime(userRecord?.tokensValidAfterTime);
    if (validAfterSeconds !== null && Number(sessionPayload.authTime) < validAfterSeconds) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function handleCreateSession(
  request: Request,
  deps: SessionRouteDeps,
) {
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const bodyToken = typeof body?.token === "string" ? body.token.trim() : "";
  const authorizationToken = parseBearerToken(request.headers.get("authorization"));
  const token = bodyToken || authorizationToken || "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  const createCookieValue = deps.createSessionCookieValue || createSessionCookieValue;
  const verifyToken = deps.verifyAccessToken || verifyAccessToken;

  try {
    const decodedToken = await verifyToken(token);
    const sessionCookieValue = await createCookieValue(normalizeSessionPayload(decodedToken));

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionCookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    const response = NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }
}

export async function handleReadSession(
  request: Request,
  deps: Pick<SessionRouteDeps, "verifySessionCookieValue" | "getUserByUid"> = {},
) {
  const token = extractCookieValue(request.headers.get("cookie"), SESSION_COOKIE) || "";
  if (!token) {
    const response = NextResponse.json({ ok: false, error: "missing_session" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  const verifyCookieValue = deps.verifySessionCookieValue || verifySessionCookieValue;
  const sessionPayload = await verifyCookieValue(token);
  const isValid = sessionPayload
    ? await validateSessionPayload(sessionPayload, deps.getUserByUid)
    : false;
  if (!isValid || !sessionPayload) {
    const response = NextResponse.json({ ok: false, error: "invalid_session" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  return NextResponse.json({
    ok: true,
    session: {
      uid: sessionPayload.uid,
      provider: sessionPayload.provider,
      role: sessionPayload.role,
      companyId: sessionPayload.companyId,
    },
  });
}

export function handleDeleteSession() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
