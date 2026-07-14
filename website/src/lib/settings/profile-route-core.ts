import { timingSafeEqual } from "node:crypto";
import {
  BusinessProfileSchema,
  BusinessProfileUpdateRequestSchema,
  ViewerProfileSchema,
  ViewerProfileUpdateRequestSchema,
  type BusinessProfileUpdateRequest,
  type ViewerProfileUpdateRequest,
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
import type {
  UpdatedBusinessProfile,
  UpdatedViewerProfile,
} from "../backend/profile-client.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const IdempotencyKeySchema = z.string().trim().min(8).max(128);
const RequestIdSchema = z.string().trim().min(1).max(200);
const CompanyIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ScopedViewerProfileUpdateSchema = ViewerProfileUpdateRequestSchema.refine(
  (value) => value.companyId !== undefined,
  { path: ["companyId"], message: "A companyId is required" },
);
const CompanyProfileUpdateBodySchema = z.object({
  companyId: CompanyIdSchema,
  profile: BusinessProfileUpdateRequestSchema,
}).strict();

interface MutationBoundaryDependencies {
  readonly websiteOrigin?: string;
  readonly nodeEnv?: string;
}

export interface ViewerProfileUpdateRouteDependencies extends MutationBoundaryDependencies {
  update(
    input: ViewerProfileUpdateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<UpdatedViewerProfile>;
}

export interface CompanyProfileUpdateRouteDependencies extends MutationBoundaryDependencies {
  update(
    companyId: number,
    input: BusinessProfileUpdateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<UpdatedBusinessProfile>;
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
  dependencies: MutationBoundaryDependencies,
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

type MutationCredentials =
  | {
      readonly ok: true;
      readonly sessionToken: WebSessionToken;
      readonly idempotencyKey: string;
    }
  | { readonly ok: false; readonly response: NextResponse };

function mutationCredentials(
  request: Request,
  dependencies: MutationBoundaryDependencies,
): MutationCredentials {
  if (!validMutationBoundary(request, dependencies)) {
    return {
      ok: false,
      response: failure(
        403,
        "MUTATION_BOUNDARY_INVALID",
        "The request origin or CSRF token is invalid.",
      ),
    };
  }

  const sessionToken = readCookie(
    request.headers.get("cookie"),
    webSessionCookieName(dependencies.nodeEnv ?? process.env.NODE_ENV),
  );
  if (!isOpaqueSessionToken(sessionToken)) {
    const unauthorized = failure(401, "SESSION_REQUIRED", "A valid website session is required.");
    clearOpaqueSessionCookies(unauthorized, dependencies.nodeEnv);
    return { ok: false, response: unauthorized };
  }

  const idempotencyKey = IdempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    return {
      ok: false,
      response: failure(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid idempotency key is required.",
        { fieldErrors: { idempotencyKey: ["Use a value between 8 and 128 characters."] } },
      ),
    };
  }

  return {
    ok: true,
    sessionToken,
    idempotencyKey: idempotencyKey.data,
  };
}

function backendFailure(
  error: BackendTransportError,
  dependencies: MutationBoundaryDependencies,
) {
  const failed = failure(error.status, error.code, error.message, {
    retryable: error.retryable,
    ...(error.requestId === null ? {} : { requestId: error.requestId }),
    ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
  });
  if (error.status === 401) clearOpaqueSessionCookies(failed, dependencies.nodeEnv);
  return failed;
}

export async function handleViewerProfileUpdate(
  request: Request,
  dependencies: ViewerProfileUpdateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;

  const parsed = ScopedViewerProfileUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The profile details are invalid.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const updated = await dependencies.update(
      parsed.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    const { requestId: rawRequestId, ...candidate } = updated;
    const requestId = RequestIdSchema.parse(rawRequestId);
    const profile = ViewerProfileSchema.parse(candidate);
    if (profile.companyId !== parsed.data.companyId) {
      throw new Error("The backend returned a mismatched profile workspace");
    }
    return response(200, {
      ok: true as const,
      data: profile,
      meta: { requestId },
    });
  } catch (error) {
    if (error instanceof BackendTransportError) return backendFailure(error, dependencies);
    return failure(500, "INTERNAL_ERROR", "The profile could not be updated.", {
      retryable: true,
    });
  }
}

export async function handleCompanyProfileUpdate(
  request: Request,
  dependencies: CompanyProfileUpdateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;

  const parsed = CompanyProfileUpdateBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The company profile details are invalid.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const updated = await dependencies.update(
      parsed.data.companyId,
      parsed.data.profile,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    const { requestId: rawRequestId, ...candidate } = updated;
    const requestId = RequestIdSchema.parse(rawRequestId);
    const profile = BusinessProfileSchema.parse(candidate);
    if (profile.companyId !== parsed.data.companyId) {
      throw new Error("The backend returned a mismatched company profile workspace");
    }
    return response(200, {
      ok: true as const,
      data: profile,
      meta: { requestId },
    });
  } catch (error) {
    if (error instanceof BackendTransportError) return backendFailure(error, dependencies);
    return failure(500, "INTERNAL_ERROR", "The company profile could not be updated.", {
      retryable: true,
    });
  }
}
