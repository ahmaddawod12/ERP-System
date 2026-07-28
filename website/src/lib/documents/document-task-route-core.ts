import {
  DocumentTaskSchema,
  RequestIdSchema,
  type DocumentTask,
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
import type { DocumentBackendResult } from "../backend/documents-client.ts";
import { BackendTransportError } from "../backend/transport-core.ts";

const CompanyIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const TaskIdSchema = z.string().trim().min(1).max(160)
  .refine((value) => !value.includes("/") && !value.includes("\\"));

export interface DocumentTaskRouteDependencies {
  readonly nodeEnv?: string;
  read(
    companyId: number,
    taskId: string,
    sessionToken: WebSessionToken,
  ): Promise<DocumentBackendResult<DocumentTask>>;
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
  options: { readonly retryable?: boolean; readonly requestId?: string } = {},
) {
  return response(status, {
    ok: false as const,
    error: { code, message, retryable: options.retryable ?? false },
    meta: { requestId: options.requestId ?? crypto.randomUUID() },
  });
}

export async function handleDocumentTaskRead(
  request: Request,
  companyIdValue: string,
  taskIdValue: string,
  dependencies: DocumentTaskRouteDependencies,
) {
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
  const taskId = TaskIdSchema.safeParse(taskIdValue);
  if (!companyId.success || !taskId.success) {
    return failure(400, "VALIDATION_ERROR", "The document task route is invalid.");
  }

  try {
    const result = await dependencies.read(companyId.data, taskId.data, sessionToken);
    const task = DocumentTaskSchema.parse(result.data);
    if (task.taskId !== taskId.data) {
      throw new Error("The backend returned a mismatched document task");
    }
    return response(200, {
      ok: true as const,
      data: task,
      meta: { requestId: RequestIdSchema.parse(result.backendRequestId) },
    });
  } catch (error) {
    if (error instanceof BackendTransportError) {
      const failed = failure(error.status, error.code, error.message, {
        retryable: error.retryable,
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
      });
      if (error.status === 401) clearOpaqueSessionCookies(failed, dependencies.nodeEnv);
      return failed;
    }
    return failure(500, "INTERNAL_ERROR", "The document task could not be read.", {
      retryable: true,
    });
  }
}
