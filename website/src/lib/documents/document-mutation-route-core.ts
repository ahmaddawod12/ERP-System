import { timingSafeEqual } from "node:crypto";
import {
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  DocumentGenerateRequestSchema,
  DocumentPreviewRequestSchema,
  DocumentTaskAcceptedSchema,
  RequestIdSchema,
  type DocumentDeleteRequest,
  type DocumentDeleteResult,
  type DocumentGenerateRequest,
  type DocumentPreviewRequest,
  type DocumentTaskAccepted,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { DocType } from "@smart-job/contracts";
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
import type { DocumentBackendResult } from "../backend/documents-client.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const CompanyIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const DocumentIdSchema = z.uuid();
const IdempotencyKeySchema = z.string().trim().min(8).max(128);

interface MutationBoundaryDependencies {
  readonly websiteOrigin?: string;
  readonly nodeEnv?: string;
}

export interface DocumentPreviewRouteDependencies extends MutationBoundaryDependencies {
  preview(
    companyId: number,
    input: DocumentPreviewRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<DocumentBackendResult<DocumentTaskAccepted>>;
}

export interface DocumentGenerateRouteDependencies extends MutationBoundaryDependencies {
  generate(
    companyId: number,
    input: DocumentGenerateRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<DocumentBackendResult<DocumentTaskAccepted>>;
}

export interface DocumentDeleteRouteDependencies extends MutationBoundaryDependencies {
  remove(
    companyId: number,
    documentId: string,
    input: DocumentDeleteRequest,
    sessionToken: WebSessionToken,
    idempotencyKey: string,
  ): Promise<DocumentBackendResult<DocumentDeleteResult>>;
}

function response<T>(status: number, body: T): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
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

function compactFieldErrors(
  errors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const compact: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages && messages.length > 0) compact[field] = messages;
  }
  return compact;
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

  const idempotencyKey = IdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
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

  return { ok: true, sessionToken, idempotencyKey: idempotencyKey.data };
}

function routeIdentity(companyIdValue: string, documentIdValue?: string) {
  const companyId = CompanyIdSchema.safeParse(companyIdValue);
  const documentId = documentIdValue === undefined
    ? null
    : DocumentIdSchema.safeParse(documentIdValue);
  if (!companyId.success || (documentId !== null && !documentId.success)) {
    return {
      ok: false as const,
      response: failure(400, "VALIDATION_ERROR", "The document route is invalid.", {
        fieldErrors: {
          ...(!companyId.success ? { companyId: ["Use a valid company identifier."] } : {}),
          ...(documentId !== null && !documentId.success
            ? { documentId: ["Use a valid document identifier."] }
            : {}),
        },
      }),
    };
  }
  return {
    ok: true as const,
    companyId: companyId.data,
    documentId: documentId?.data ?? null,
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
  return failure(500, "INTERNAL_ERROR", "The document action could not be completed.", {
    retryable: true,
  });
}

function isTaxDocumentRequest(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && "documentType" in value
    && (value as { readonly documentType?: unknown }).documentType === DocType.TaxInvoice;
}

function taxWorkflowRequired() {
  return failure(
    503,
    "TAX_SUBMISSION_DISABLED",
    "Tax invoice submission is unavailable pending Tax Authority certification.",
    { fieldErrors: { documentType: ["Tax submission is not currently available."] } },
  );
}

export async function handleDocumentPreview(
  request: Request,
  companyIdValue: string,
  dependencies: DocumentPreviewRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue);
  if (!identity.ok) return identity.response;
  const rawBody = await request.json().catch(() => null);
  if (isTaxDocumentRequest(rawBody)) return taxWorkflowRequired();
  const body = DocumentPreviewRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The document preview is invalid.", {
      fieldErrors: compactFieldErrors(body.error.flatten().fieldErrors),
    });
  }

  try {
    const accepted = await dependencies.preview(
      identity.companyId,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    return response(202, {
      ok: true as const,
      data: DocumentTaskAcceptedSchema.parse(accepted.data),
      meta: { requestId: RequestIdSchema.parse(accepted.backendRequestId) },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export async function handleDocumentGenerate(
  request: Request,
  companyIdValue: string,
  dependencies: DocumentGenerateRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue);
  if (!identity.ok) return identity.response;
  const rawBody = await request.json().catch(() => null);
  if (isTaxDocumentRequest(rawBody)) return taxWorkflowRequired();
  const body = DocumentGenerateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The document details are invalid.", {
      fieldErrors: compactFieldErrors(body.error.flatten().fieldErrors),
    });
  }

  try {
    const accepted = await dependencies.generate(
      identity.companyId,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    return response(202, {
      ok: true as const,
      data: DocumentTaskAcceptedSchema.parse(accepted.data),
      meta: { requestId: RequestIdSchema.parse(accepted.backendRequestId) },
    });
  } catch (error) {
    return backendFailure(error, dependencies.nodeEnv);
  }
}

export async function handleDocumentDelete(
  request: Request,
  companyIdValue: string,
  documentIdValue: string,
  dependencies: DocumentDeleteRouteDependencies,
) {
  const credentials = mutationCredentials(request, dependencies);
  if (!credentials.ok) return credentials.response;
  const identity = routeIdentity(companyIdValue, documentIdValue);
  if (!identity.ok) return identity.response;
  const body = DocumentDeleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return failure(400, "VALIDATION_ERROR", "The document version is invalid.", {
      fieldErrors: compactFieldErrors(body.error.flatten().fieldErrors),
    });
  }

  try {
    const removed = await dependencies.remove(
      identity.companyId,
      identity.documentId!,
      body.data,
      credentials.sessionToken,
      credentials.idempotencyKey,
    );
    const result = DocumentDeleteResultSchema.parse(removed.data);
    if (result.documentId !== identity.documentId) {
      throw new Error("The backend returned a mismatched document");
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
