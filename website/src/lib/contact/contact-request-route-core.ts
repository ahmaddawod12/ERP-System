import type {
  ContactRequestCreateRequest,
  ContactRequestCreatedResult,
} from "@smart-job/api-contracts";
import { NextResponse } from "next/server.js";
import { z } from "zod";

import { parseWebsiteOrigin } from "../auth/opaque-session.ts";
import { BackendTransportError } from "../backend/transport-core.ts";
import { contactRequestSchema } from "../validation/schemas.ts";

const IdempotencyKeySchema = z.string().trim().min(8).max(128);

interface CreatedContact {
  readonly data: ContactRequestCreatedResult;
  readonly backendRequestId: string;
}

export interface ContactRequestRouteDependencies {
  create(
    input: ContactRequestCreateRequest,
    idempotencyKey: string,
  ): Promise<CreatedContact>;
  verifyChallenge(token: string, answer: string): Promise<boolean>;
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

function hasExpectedOrigin(
  request: Request,
  dependencies: ContactRequestRouteDependencies,
): boolean {
  try {
    const expected = parseWebsiteOrigin(
      dependencies.websiteOrigin ?? String(process.env.WEBSITE_ORIGIN || ""),
      dependencies.nodeEnv ?? process.env.NODE_ENV,
    );
    return request.headers.get("origin") === expected;
  } catch {
    return false;
  }
}

export async function handleContactRequest(
  request: Request,
  dependencies: ContactRequestRouteDependencies,
) {
  if (!hasExpectedOrigin(request, dependencies)) {
    return failure(403, "ORIGIN_INVALID", "The request origin is not allowed.");
  }

  const idempotencyKey = IdempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    return failure(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid idempotency key is required.", {
      fieldErrors: { idempotencyKey: ["Use a value between 8 and 128 characters."] },
    });
  }

  const parsed = contactRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The contact request is invalid.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  if (parsed.data.website) {
    return failure(400, "SPAM_REJECTED", "The contact request was rejected.");
  }
  if (!await dependencies.verifyChallenge(parsed.data.challengeToken, parsed.data.challenge)) {
    return failure(400, "INVALID_CHALLENGE", "The challenge response is invalid or expired.");
  }

  try {
    const created = await dependencies.create({
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company,
      subject: null,
      message: parsed.data.message,
    }, idempotencyKey.data);
    return response(201, {
      ok: true as const,
      data: created.data,
      meta: { requestId: created.backendRequestId },
    });
  } catch (error) {
    if (error instanceof BackendTransportError) {
      return failure(error.status, error.code, error.message, {
        retryable: error.retryable,
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
        ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
      });
    }
    return failure(500, "INTERNAL_ERROR", "The contact request could not be sent.", {
      retryable: true,
    });
  }
}
