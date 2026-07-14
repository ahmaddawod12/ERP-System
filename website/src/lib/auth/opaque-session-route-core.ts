import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server.js";
import type { Viewer } from "@smart-job/api-contracts";
import { BackendTransportError } from "../backend/transport-core.ts";
import {
  WebSessionCreateRequestSchema,
  type WebSessionCreateRequest,
} from "./web-session-contract.ts";
import {
  clearOpaqueSessionCookies,
  isCsrfToken,
  isOpaqueSessionToken,
  parseWebsiteOrigin,
  readCookie,
  setOpaqueSessionCookies,
  WEB_CSRF_COOKIE,
  webSessionCookieName,
} from "./opaque-session.ts";

interface CreatedSession {
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: string;
  viewer: Viewer;
  requestId: string;
}

interface CurrentSession {
  absoluteExpiresAt: string;
  viewer: Viewer;
  requestId: string;
}

interface RevokedSession {
  revoked: boolean;
  requestId: string;
}

export interface OpaqueSessionRouteDeps {
  createSession(input: WebSessionCreateRequest): Promise<CreatedSession>;
  readSession(sessionToken: string): Promise<CurrentSession>;
  revokeSession(sessionToken: string, csrfToken: string): Promise<RevokedSession>;
  websiteOrigin?: string;
  nodeEnv?: string;
  now?: () => number;
}

function success<T>(data: T, id: string, status = 200) {
  const response = NextResponse.json({ ok: true, data, meta: { requestId: id } }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function failure(
  status: number,
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    requestId?: string;
    fieldErrors?: Record<string, string[]>;
  } = {},
) {
  const response = NextResponse.json({
    ok: false,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    },
    meta: { requestId: options.requestId || crypto.randomUUID() },
  }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function backendFailure(error: unknown) {
  if (error instanceof BackendTransportError) {
    return failure(error.status, error.code, error.message, {
      retryable: error.retryable,
      requestId: error.requestId || undefined,
      fieldErrors: error.fieldErrors,
    });
  }
  return failure(500, "INTERNAL_ERROR", "An unexpected error occurred.", { retryable: true });
}

function expectedOrigin(deps: OpaqueSessionRouteDeps): string {
  return parseWebsiteOrigin(
    deps.websiteOrigin ?? String(process.env.WEBSITE_ORIGIN || ""),
    deps.nodeEnv ?? process.env.NODE_ENV,
  );
}

function hasExpectedOrigin(request: Request, deps: OpaqueSessionRouteDeps): boolean {
  try {
    return request.headers.get("origin") === expectedOrigin(deps);
  } catch {
    return false;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function readSessionToken(request: Request, deps: OpaqueSessionRouteDeps): string | null {
  const token = readCookie(
    request.headers.get("cookie"),
    webSessionCookieName(deps.nodeEnv ?? process.env.NODE_ENV),
  );
  return isOpaqueSessionToken(token) ? token : null;
}

function readAndValidateCsrf(request: Request): string | null {
  const cookieToken = readCookie(request.headers.get("cookie"), WEB_CSRF_COOKIE);
  const headerToken = request.headers.get("x-sj-csrf");
  if (!isCsrfToken(cookieToken) || !isCsrfToken(headerToken)) {
    return null;
  }
  return safeEqual(cookieToken, headerToken) ? headerToken : null;
}

export async function handleOpaqueSessionLogin(
  request: Request,
  deps: OpaqueSessionRouteDeps,
) {
  if (!hasExpectedOrigin(request, deps)) {
    return failure(403, "ORIGIN_INVALID", "The request origin is not allowed.");
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = WebSessionCreateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "Email and password are required.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const created = await deps.createSession(parsed.data);
    const response = success({
      viewer: created.viewer,
      absoluteExpiresAt: created.absoluteExpiresAt,
    }, created.requestId, 201);
    setOpaqueSessionCookies(response, created, {
      nodeEnv: deps.nodeEnv,
      nowMs: deps.now?.(),
    });
    return response;
  } catch (error) {
    return backendFailure(error);
  }
}

export async function handleOpaqueSessionRead(
  request: Request,
  deps: OpaqueSessionRouteDeps,
) {
  const sessionToken = readSessionToken(request, deps);
  if (!sessionToken) {
    const response = failure(401, "SESSION_REQUIRED", "A valid website session is required.");
    clearOpaqueSessionCookies(response, deps.nodeEnv);
    return response;
  }

  try {
    const current = await deps.readSession(sessionToken);
    return success({
      viewer: current.viewer,
      absoluteExpiresAt: current.absoluteExpiresAt,
    }, current.requestId);
  } catch (error) {
    const response = backendFailure(error);
    if (error instanceof BackendTransportError && error.status === 401) {
      clearOpaqueSessionCookies(response, deps.nodeEnv);
    }
    return response;
  }
}

export async function handleOpaqueSessionLogout(
  request: Request,
  deps: OpaqueSessionRouteDeps,
) {
  if (!hasExpectedOrigin(request, deps)) {
    return failure(403, "ORIGIN_INVALID", "The request origin is not allowed.");
  }

  const sessionToken = readSessionToken(request, deps);
  const csrfToken = readAndValidateCsrf(request);
  if (!sessionToken) {
    const response = success({ revoked: false }, crypto.randomUUID());
    clearOpaqueSessionCookies(response, deps.nodeEnv);
    return response;
  }
  if (!csrfToken) {
    return failure(403, "CSRF_INVALID", "The CSRF token is missing or invalid.");
  }

  try {
    const revoked = await deps.revokeSession(sessionToken, csrfToken);
    const response = success({ revoked: revoked.revoked }, revoked.requestId);
    clearOpaqueSessionCookies(response, deps.nodeEnv);
    return response;
  } catch (error) {
    const response = backendFailure(error);
    // Keep a still-valid opaque session on transient backend failures so the
    // user can retry revocation. A definitive 401 means the backend no longer
    // accepts the session, so clearing the local cookies is safe.
    if (error instanceof BackendTransportError && error.status === 401) {
      clearOpaqueSessionCookies(response, deps.nodeEnv);
    }
    return response;
  }
}
