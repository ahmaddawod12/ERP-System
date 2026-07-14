import type { ApiResponse } from "@smart-job/api-contracts";

type SuccessEnvelope<T> = Extract<ApiResponse<T>, { ok: true }>;
type ErrorEnvelope = Extract<ApiResponse<never>, { ok: false }>;

export function success<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { ok: true, data, meta: { requestId } };
}

export function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
): ErrorEnvelope {
  return {
    ok: false,
    error: { code, message, retryable },
    meta: { requestId },
  };
}
