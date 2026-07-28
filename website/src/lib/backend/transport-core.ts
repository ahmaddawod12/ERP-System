import {
  createApiResponseSchema,
  type ApiError,
  type ApiResponse,
} from "@smart-job/api-contracts";
import type { z } from "zod";

const MAX_BACKEND_RESPONSE_BYTES = 1_000_000;

interface BackendTransportErrorOptions {
  status: number;
  code: string;
  message: string;
  retryable?: boolean;
  requestId?: string;
  fieldErrors?: Record<string, string[]>;
  cause?: unknown;
}

export class BackendTransportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(options: BackendTransportErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "BackendTransportError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
    this.fieldErrors = options.fieldErrors;
  }
}

export interface BackendResult<T> {
  data: T;
  meta: {
    requestId: string;
    nextCursor?: string | null;
  };
}

export interface BackendTransport {
  request<T>(
    path: string,
    dataSchema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<BackendResult<T>>;
}

export interface BackendTransportOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function safeStatus(status: number): number {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function apiFailureError(status: number, error: ApiError, requestId: string) {
  return new BackendTransportError({
    status: safeStatus(status),
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    requestId,
    fieldErrors: error.fieldErrors,
  });
}

function validatePath(path: string): void {
  if (!path.startsWith("/api/v1/") || path.startsWith("//") || path.includes("#")) {
    throw new BackendTransportError({
      status: 500,
      code: "BACKEND_PATH_INVALID",
      message: "The server backend path is invalid.",
    });
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BACKEND_RESPONSE_BYTES) {
    throw new BackendTransportError({
      status: 502,
      code: "BACKEND_RESPONSE_TOO_LARGE",
      message: "The backend returned an invalid response.",
      retryable: true,
    });
  }

  const text = await response.text();
  if (text.length > MAX_BACKEND_RESPONSE_BYTES) {
    throw new BackendTransportError({
      status: 502,
      code: "BACKEND_RESPONSE_TOO_LARGE",
      message: "The backend returned an invalid response.",
      retryable: true,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new BackendTransportError({
      status: 502,
      code: "BACKEND_RESPONSE_INVALID",
      message: "The backend returned an invalid response.",
      retryable: true,
      cause,
    });
  }
}

export function createBackendTransport(options: BackendTransportOptions): BackendTransport {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async request<T>(path: string, dataSchema: z.ZodType<T>, init: RequestInit = {}) {
      validatePath(path);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      const externalSignal = init.signal;
      const abortFromCaller = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) {
        abortFromCaller();
      } else {
        externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
      }

      let response: Response;
      let rawPayload: unknown;
      try {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/json");
        response = await fetchImpl(new URL(path, options.baseUrl), {
          ...init,
          headers,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        // Keep the same timeout active while consuming the body. `fetch()` can
        // resolve after headers while a stalled response body is still open.
        rawPayload = await readResponsePayload(response);
      } catch (cause) {
        if (cause instanceof BackendTransportError) {
          throw cause;
        }
        throw new BackendTransportError({
          status: controller.signal.aborted && !externalSignal?.aborted ? 504 : 503,
          code: controller.signal.aborted && !externalSignal?.aborted
            ? "BACKEND_TIMEOUT"
            : "BACKEND_UNAVAILABLE",
          message: controller.signal.aborted && !externalSignal?.aborted
            ? "The backend request timed out."
            : "The backend is temporarily unavailable.",
          retryable: true,
          cause,
        });
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abortFromCaller);
      }

      const responseSchema = createApiResponseSchema(dataSchema);
      const parsed = responseSchema.safeParse(rawPayload);
      if (!parsed.success) {
        throw new BackendTransportError({
          status: 502,
          code: "BACKEND_RESPONSE_INVALID",
          message: "The backend returned an invalid response.",
          retryable: true,
          cause: parsed.error,
        });
      }

      const payload = parsed.data as ApiResponse<T>;
      if (!payload.ok) {
        throw apiFailureError(response.status, payload.error, payload.meta.requestId);
      }
      if (!response.ok) {
        throw new BackendTransportError({
          status: 502,
          code: "BACKEND_STATUS_INVALID",
          message: "The backend returned an inconsistent response.",
          retryable: true,
          requestId: payload.meta.requestId,
        });
      }

      return {
        data: payload.data,
        meta: payload.meta,
      };
    },
  };
}
