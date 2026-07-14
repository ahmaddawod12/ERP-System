import { timingSafeEqual } from "node:crypto";
import {
  InventoryAdjustmentRequestSchema,
  InventoryPartArchiveRequestSchema,
  InventoryPartCreateRequestSchema,
  InventoryPartSummarySchema,
  InventoryPartUpdateRequestSchema,
  type InventoryAdjustmentRequest,
  type InventoryPartArchiveRequest,
  type InventoryPartCreateRequest,
  type InventoryPartSummary,
  type InventoryPartUpdateRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { NextResponse } from "next/server.js";
import { z, type ZodType } from "zod";

import {
  clearOpaqueSessionCookies,
  isCsrfToken,
  isOpaqueSessionToken,
  parseWebsiteOrigin,
  readCookie,
  WEB_CSRF_COOKIE,
  webSessionCookieName,
} from "../auth/opaque-session.ts";
import type { InventoryMutationResult } from "../backend/inventory-client.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const CompanyIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const PartIdSchema = z.uuid();
const IdempotencyKeySchema = z.string().trim().min(8).max(128);
const RequestIdSchema = z.string().trim().min(1).max(200);

interface MutationBoundaryDependencies {
  readonly websiteOrigin?: string;
  readonly nodeEnv?: string;
}

type PartMutation<T> = (
  companyId: number,
  partId: string,
  input: T,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
) => Promise<InventoryMutationResult<InventoryPartSummary>>;

export interface InventoryCreateRouteDependencies extends MutationBoundaryDependencies {
  create(
    companyId: number,
    input: InventoryPartCreateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<InventoryMutationResult<InventoryPartSummary>>;
}

export interface InventoryUpdateRouteDependencies extends MutationBoundaryDependencies {
  update: PartMutation<InventoryPartUpdateRequest>;
}

export interface InventoryArchiveRouteDependencies extends MutationBoundaryDependencies {
  archive: PartMutation<InventoryPartArchiveRequest>;
}

export interface InventoryAdjustmentRouteDependencies extends MutationBoundaryDependencies {
  adjust: PartMutation<InventoryAdjustmentRequest>;
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
  let expectedOrigin: string;
  try {
    expectedOrigin = parseWebsiteOrigin(
      dependencies.websiteOrigin ?? String(process.env.WEBSITE_ORIGIN || ""),
      dependencies.nodeEnv ?? process.env.NODE_ENV,
    );
  } catch {
    return {
      ok: false,
      response: failure(403, "MUTATION_BOUNDARY_INVALID", "The request origin or CSRF token is invalid."),
    };
  }

  const csrfCookie = readCookie(request.headers.get("cookie"), WEB_CSRF_COOKIE);
  const csrfHeader = request.headers.get("x-sj-csrf");
  if (
    request.headers.get("origin") !== expectedOrigin
    || !isCsrfToken(csrfCookie)
    || !isCsrfToken(csrfHeader)
    || !safeEqual(csrfCookie, csrfHeader)
  ) {
    return {
      ok: false,
      response: failure(403, "MUTATION_BOUNDARY_INVALID", "The request origin or CSRF token is invalid."),
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
      response: failure(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid idempotency key is required.", {
        fieldErrors: { idempotencyKey: ["Use a value between 8 and 128 characters."] },
      }),
    };
  }

  return {
    ok: true,
    sessionToken,
    idempotencyKey: idempotencyKey.data,
  };
}

function routeIdentity(companyIdValue: string, partIdValue?: string) {
  const companyId = CompanyIdSchema.safeParse(companyIdValue);
  const partId = partIdValue === undefined ? null : PartIdSchema.safeParse(partIdValue);
  if (!companyId.success || (partId !== null && !partId.success)) {
    return {
      ok: false as const,
      response: failure(400, "VALIDATION_ERROR", "The inventory route is invalid.", {
        fieldErrors: {
          ...(!companyId.success ? { companyId: ["Use a valid company identifier."] } : {}),
          ...(partId !== null && !partId.success
            ? { partId: ["Use a valid inventory part identifier."] }
            : {}),
        },
      }),
    };
  }
  return {
    ok: true as const,
    companyId: companyId.data,
    partId: partId?.data ?? null,
  };
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
  return failure(500, "INTERNAL_ERROR", "The inventory action could not be completed.", {
    retryable: true,
  });
}

function compactFieldErrors(
  errors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(errors).filter((entry): entry is [string, string[]] => entry[1] !== undefined),
  );
}

function success(status: number, mutation: InventoryMutationResult<InventoryPartSummary>) {
  return response(status, {
    ok: true as const,
    data: InventoryPartSummarySchema.parse(mutation.data),
    meta: { requestId: RequestIdSchema.parse(mutation.backendRequestId) },
  });
}

async function handlePartMutation<T>(input: {
  readonly request: Request;
  readonly companyIdValue: string;
  readonly partIdValue: string;
  readonly dependencies: MutationBoundaryDependencies;
  readonly bodySchema: ZodType<T>;
  readonly mutate: PartMutation<T>;
}) {
  const credentials = mutationCredentials(input.request, input.dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(input.companyIdValue, input.partIdValue);
  if (!identity.ok) return identity.response;
  const body = input.bodySchema.safeParse(await input.request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The inventory details are invalid.", {
      fieldErrors: compactFieldErrors(body.error.flatten().fieldErrors),
    });
  }

  try {
    const result = await input.mutate(
      identity.companyId,
      identity.partId!,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    if (result.data.partId !== identity.partId) {
      throw new Error("The backend returned a mismatched inventory part");
    }
    return success(200, result);
  } catch (error) {
    return backendFailure(error, input.dependencies.nodeEnv);
  }
}

export async function handleInventoryPartCreate(
  request: Request,
  companyIdValue: string,
  dependencies: InventoryCreateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue);
  if (!identity.ok) return identity.response;
  const body = InventoryPartCreateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The inventory part details are invalid.", {
      fieldErrors: body.error.flatten().fieldErrors,
    });
  }

  try {
    return success(201, await dependencies.create(
      identity.companyId,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    ));
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export function handleInventoryPartUpdate(
  request: Request,
  companyIdValue: string,
  partIdValue: string,
  dependencies: InventoryUpdateRouteDependencies,
) {
  return handlePartMutation({
    request,
    companyIdValue,
    partIdValue,
    dependencies,
    bodySchema: InventoryPartUpdateRequestSchema,
    mutate: dependencies.update,
  });
}

export function handleInventoryPartArchive(
  request: Request,
  companyIdValue: string,
  partIdValue: string,
  dependencies: InventoryArchiveRouteDependencies,
) {
  return handlePartMutation({
    request,
    companyIdValue,
    partIdValue,
    dependencies,
    bodySchema: InventoryPartArchiveRequestSchema,
    mutate: dependencies.archive,
  });
}

export function handleInventoryAdjustment(
  request: Request,
  companyIdValue: string,
  partIdValue: string,
  dependencies: InventoryAdjustmentRouteDependencies,
) {
  return handlePartMutation({
    request,
    companyIdValue,
    partIdValue,
    dependencies,
    bodySchema: InventoryAdjustmentRequestSchema,
    mutate: dependencies.adjust,
  });
}
