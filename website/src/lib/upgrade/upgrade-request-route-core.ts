import { timingSafeEqual } from "node:crypto";
import {
  UpgradeRequestCreateRequestSchema,
  UpgradeRequestModerationRequestSchema,
  type UpgradeRequestCreateRequest,
  type UpgradeRequestModerationRequest,
  type UpgradeRequestSummary,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { NextResponse } from "next/server.js";
import { z } from "zod";

import {
  clearOpaqueSessionCookies,
  isCsrfToken,
  isOpaqueSessionToken,
  parseWebsiteOrigin,
  readCookie,
  WEB_CSRF_COOKIE,
  webSessionCookieName,
} from "../auth/opaque-session.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const IdempotencyKeySchema = z.string().trim().min(8).max(128);
const RequestIdSchema = z.uuid();

interface UpgradeMutationResult {
  readonly data: UpgradeRequestSummary;
  readonly backendRequestId: string;
}

export interface UpgradeRequestRouteDependencies {
  create(
    input: UpgradeRequestCreateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<UpgradeMutationResult>;
  moderate(
    requestId: string,
    input: UpgradeRequestModerationRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<UpgradeMutationResult>;
  readonly websiteOrigin?: string;
  readonly nodeEnv?: string;
}

function response<T>(status: number, body: T): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function failure(
  status: number,
  code: string,
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly requestId?: string;
    readonly fieldErrors?: Record<string, string[]>;
  } = {},
) {
  return response(status, {
    ok: false as const,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.fieldErrors === undefined ? {} : { fieldErrors: options.fieldErrors }),
    },
    meta: { requestId: options.requestId ?? crypto.randomUUID() },
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function mutationContext(
  request: Request,
  dependencies: UpgradeRequestRouteDependencies,
): { sessionToken: WebSessionToken; idempotencyKey: string } | NextResponse {
  let expectedOrigin: string;
  try {
    expectedOrigin = parseWebsiteOrigin(
      dependencies.websiteOrigin ?? String(process.env.WEBSITE_ORIGIN || ""),
      dependencies.nodeEnv ?? process.env.NODE_ENV,
    );
  } catch {
    return failure(403, "MUTATION_BOUNDARY_INVALID", "The request origin or CSRF token is invalid.");
  }
  const csrfCookie = readCookie(request.headers.get("cookie"), WEB_CSRF_COOKIE);
  const csrfHeader = request.headers.get("x-sj-csrf");
  if (
    request.headers.get("origin") !== expectedOrigin
    || !isCsrfToken(csrfCookie)
    || !isCsrfToken(csrfHeader)
    || !safeEqual(csrfCookie, csrfHeader)
  ) {
    return failure(403, "MUTATION_BOUNDARY_INVALID", "The request origin or CSRF token is invalid.");
  }

  const sessionToken = readCookie(
    request.headers.get("cookie"),
    webSessionCookieName(dependencies.nodeEnv ?? process.env.NODE_ENV),
  );
  if (!isOpaqueSessionToken(sessionToken)) {
    const unauthorized = failure(401, "SESSION_REQUIRED", "A valid website session is required.");
    clearOpaqueSessionCookies(unauthorized, dependencies.nodeEnv);
    return unauthorized;
  }
  const idempotencyKey = IdempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    return failure(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid idempotency key is required.", {
      fieldErrors: { idempotencyKey: ["Use a value between 8 and 128 characters."] },
    });
  }
  return { sessionToken, idempotencyKey: idempotencyKey.data };
}

function backendFailure(error: unknown, nodeEnv?: string): NextResponse {
  if (error instanceof BackendTransportError) {
    const failed = failure(error.status, error.code, error.message, {
      retryable: error.retryable,
      ...(error.requestId === null ? {} : { requestId: error.requestId }),
      ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
    });
    if (error.status === 401) clearOpaqueSessionCookies(failed, nodeEnv);
    return failed;
  }
  return failure(500, "INTERNAL_ERROR", "The upgrade action could not be completed.", {
    retryable: true,
  });
}

export async function handleUpgradeRequestCreate(
  request: Request,
  dependencies: UpgradeRequestRouteDependencies,
) {
  const context = mutationContext(request, dependencies);
  if (context instanceof NextResponse) return context;
  const parsed = UpgradeRequestCreateRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The upgrade request is invalid.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const created = await dependencies.create(
      parsed.data,
      context.sessionToken,
      context.idempotencyKey,
    );
    return response(201, {
      ok: true as const,
      data: created.data,
      meta: { requestId: created.backendRequestId },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export async function handleUpgradeRequestModeration(
  request: Request,
  requestIdValue: string,
  dependencies: UpgradeRequestRouteDependencies,
) {
  const context = mutationContext(request, dependencies);
  if (context instanceof NextResponse) return context;
  const requestId = RequestIdSchema.safeParse(requestIdValue);
  const body = UpgradeRequestModerationRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!requestId.success || !body.success) {
    return failure(400, "VALIDATION_ERROR", "The moderation request is invalid.", {
      fieldErrors: {
        ...(!requestId.success ? { requestId: ["Use a valid request identifier."] } : {}),
        ...(!body.success ? body.error.flatten().fieldErrors : {}),
      },
    });
  }
  try {
    const moderated = await dependencies.moderate(
      requestId.data,
      body.data,
      context.sessionToken,
      context.idempotencyKey,
    );
    return response(200, {
      ok: true as const,
      data: moderated.data,
      meta: { requestId: moderated.backendRequestId },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}
