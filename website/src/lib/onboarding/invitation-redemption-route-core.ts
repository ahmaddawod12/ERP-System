import { timingSafeEqual } from "node:crypto";
import {
  InvitationRedeemRequestSchema,
  type InvitationRedeemRequest,
  type InvitationRedemptionResult,
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

interface RedeemedInvitationResult extends InvitationRedemptionResult {
  readonly requestId: string;
}

export interface InvitationRedemptionRouteDependencies {
  redeem(
    input: InvitationRedeemRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<RedeemedInvitationResult>;
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

function validMutationBoundary(
  request: Request,
  dependencies: InvitationRedemptionRouteDependencies,
): boolean {
  try {
    const expectedOrigin = parseWebsiteOrigin(
      dependencies.websiteOrigin ?? String(process.env.WEBSITE_ORIGIN || ""),
      dependencies.nodeEnv ?? process.env.NODE_ENV,
    );
    const csrfCookie = readCookie(request.headers.get("cookie"), WEB_CSRF_COOKIE);
    const csrfHeader = request.headers.get("x-sj-csrf");
    return request.headers.get("origin") === expectedOrigin
      && isCsrfToken(csrfCookie)
      && isCsrfToken(csrfHeader)
      && safeEqual(csrfCookie, csrfHeader);
  } catch {
    return false;
  }
}

export async function handleInvitationRedemption(
  request: Request,
  dependencies: InvitationRedemptionRouteDependencies,
) {
  if (!validMutationBoundary(request, dependencies)) {
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

  const parsed = InvitationRedeemRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The invitation details are invalid.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const redeemed = await dependencies.redeem(
      parsed.data,
      sessionToken,
      idempotencyKey.data,
    );
    const { requestId, ...data } = redeemed;
    return response(200, {
      ok: true as const,
      data,
      meta: { requestId },
    });
  } catch (error) {
    if (error instanceof BackendTransportError) {
      const failed = failure(error.status, error.code, error.message, {
        retryable: error.retryable,
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
        ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
      });
      if (error.status === 401) clearOpaqueSessionCookies(failed, dependencies.nodeEnv);
      return failed;
    }
    return failure(500, "INTERNAL_ERROR", "The invitation could not be redeemed.", {
      retryable: true,
    });
  }
}
