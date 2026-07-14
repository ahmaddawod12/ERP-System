import { timingSafeEqual } from "node:crypto";
import {
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteResultSchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  type ClientCreateRequest,
  type ClientDeleteRequest,
  type ClientDeleteResult,
  type ClientSummary,
  type ClientUpdateRequest,
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
import type { ClientMutationResult } from "../backend/clients-client.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const CompanyIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ClientIdSchema = z.uuid();
const IdempotencyKeySchema = z.string().trim().min(8).max(128);
const RequestIdSchema = z.string().trim().min(1).max(200);

interface MutationBoundaryDependencies {
  readonly websiteOrigin?: string;
  readonly nodeEnv?: string;
}

export interface ClientCreateRouteDependencies extends MutationBoundaryDependencies {
  create(
    companyId: number,
    input: ClientCreateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<ClientMutationResult<ClientSummary>>;
}

export interface ClientUpdateRouteDependencies extends MutationBoundaryDependencies {
  update(
    companyId: number,
    clientId: string,
    input: ClientUpdateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<ClientMutationResult<ClientSummary>>;
}

export interface ClientDeleteRouteDependencies extends MutationBoundaryDependencies {
  remove(
    companyId: number,
    clientId: string,
    input: ClientDeleteRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<ClientMutationResult<ClientDeleteResult>>;
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
      response: failure(
        403,
        "MUTATION_BOUNDARY_INVALID",
        "The request origin or CSRF token is invalid.",
      ),
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

function routeIdentity(companyIdValue: string, clientIdValue?: string) {
  const companyId = CompanyIdSchema.safeParse(companyIdValue);
  const clientId = clientIdValue === undefined
    ? null
    : ClientIdSchema.safeParse(clientIdValue);
  if (!companyId.success || (clientId !== null && !clientId.success)) {
    return {
      ok: false as const,
      response: failure(400, "VALIDATION_ERROR", "The client route is invalid.", {
        fieldErrors: {
          ...(!companyId.success ? { companyId: ["Use a valid company identifier."] } : {}),
          ...(clientId !== null && !clientId.success
            ? { clientId: ["Use a valid client identifier."] }
            : {}),
        },
      }),
    };
  }
  return {
    ok: true as const,
    companyId: companyId.data,
    clientId: clientId?.data ?? null,
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
  return failure(500, "INTERNAL_ERROR", "The client action could not be completed.", {
    retryable: true,
  });
}

export async function handleClientCreate(
  request: Request,
  companyIdValue: string,
  dependencies: ClientCreateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue);
  if (!identity.ok) return identity.response;
  const body = ClientCreateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The client details are invalid.", {
      fieldErrors: body.error.flatten().fieldErrors,
    });
  }

  try {
    const created = await dependencies.create(
      identity.companyId,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    return response(201, {
      ok: true as const,
      data: ClientSummarySchema.parse(created.data),
      meta: { requestId: RequestIdSchema.parse(created.backendRequestId) },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export async function handleClientUpdate(
  request: Request,
  companyIdValue: string,
  clientIdValue: string,
  dependencies: ClientUpdateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue, clientIdValue);
  if (!identity.ok) return identity.response;
  const body = ClientUpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The client details are invalid.", {
      fieldErrors: body.error.flatten().fieldErrors,
    });
  }

  try {
    const updated = await dependencies.update(
      identity.companyId,
      identity.clientId!,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    const client = ClientSummarySchema.parse(updated.data);
    if (client.clientId !== identity.clientId) {
      throw new Error("The backend returned a mismatched client");
    }
    return response(200, {
      ok: true as const,
      data: client,
      meta: { requestId: RequestIdSchema.parse(updated.backendRequestId) },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export async function handleClientDelete(
  request: Request,
  companyIdValue: string,
  clientIdValue: string,
  dependencies: ClientDeleteRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue, clientIdValue);
  if (!identity.ok) return identity.response;
  const body = ClientDeleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The client version is invalid.", {
      fieldErrors: body.error.flatten().fieldErrors,
    });
  }

  try {
    const removed = await dependencies.remove(
      identity.companyId,
      identity.clientId!,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    const result = ClientDeleteResultSchema.parse(removed.data);
    if (result.clientId !== identity.clientId) {
      throw new Error("The backend returned a mismatched client");
    }
    return response(200, {
      ok: true as const,
      data: result,
      meta: { requestId: RequestIdSchema.parse(removed.backendRequestId) },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}
