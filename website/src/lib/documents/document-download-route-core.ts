import {
  type DocumentDownloadAccess,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { NextResponse } from "next/server.js";
import { z } from "zod";
import {
  clearOpaqueSessionCookies,
  isOpaqueSessionToken,
  readCookie,
  webSessionCookieName,
} from "../auth/opaque-session.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const CompanyIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const DocumentIdSchema = z.uuid();
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface DocumentDownloadRouteDependencies {
  readonly nodeEnv?: string;
  readonly nowMs?: number;
  read(
    companyId: number,
    documentId: string,
    sessionToken: WebSessionToken,
  ): Promise<DocumentDownloadAccess>;
}

function jsonResponse<T>(status: number, body: T): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(
  status: number,
  code: string,
  message: string,
  options: { readonly retryable?: boolean; readonly requestId?: string } = {},
) {
  return jsonResponse(status, {
    ok: false as const,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
    },
    meta: { requestId: options.requestId ?? crypto.randomUUID() },
  });
}

function safeDownloadUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  return null;
}

function redirectToDownload(url: URL): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: url.href,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleDocumentDownload(
  request: Request,
  companyIdValue: string,
  documentIdValue: string,
  dependencies: DocumentDownloadRouteDependencies,
): Promise<Response> {
  const sessionToken = readCookie(
    request.headers.get("cookie"),
    webSessionCookieName(dependencies.nodeEnv ?? process.env.NODE_ENV),
  );
  if (!isOpaqueSessionToken(sessionToken)) {
    const unauthorized = failure(401, "SESSION_REQUIRED", "A valid website session is required.");
    clearOpaqueSessionCookies(unauthorized, dependencies.nodeEnv);
    return unauthorized;
  }

  const companyId = CompanyIdSchema.safeParse(companyIdValue);
  const documentId = DocumentIdSchema.safeParse(documentIdValue);
  if (!companyId.success || !documentId.success) {
    return failure(400, "VALIDATION_ERROR", "The document download route is invalid.");
  }

  try {
    const access = await dependencies.read(companyId.data, documentId.data, sessionToken);
    if (access.documentId !== documentId.data) {
      throw new Error("The backend returned a mismatched document");
    }
    const downloadUrl = safeDownloadUrl(access.downloadURL);
    const expiryMs = Date.parse(access.expiresAt);
    const nowMs = dependencies.nowMs ?? Date.now();
    if (!downloadUrl || !Number.isFinite(expiryMs) || expiryMs <= nowMs) {
      throw new Error("The backend returned invalid document access");
    }
    return redirectToDownload(downloadUrl);
  } catch (error) {
    if (error instanceof BackendTransportError) {
      const failed = failure(error.status, error.code, error.message, {
        retryable: error.retryable,
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
      });
      if (error.status === 401) clearOpaqueSessionCookies(failed, dependencies.nodeEnv);
      return failed;
    }
    return failure(
      502,
      "DOCUMENT_DOWNLOAD_INVALID",
      "The document file could not be opened safely.",
      { retryable: true },
    );
  }
}
