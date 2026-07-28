import type { ApiError, ApiResponse, Cursor } from "@smart-job/api-contracts";

export type { ApiError, ApiResponse } from "@smart-job/api-contracts";

export function apiSuccess<T>(
  requestId: string,
  data: T,
  nextCursor?: Cursor | null,
): ApiResponse<T> {
  return nextCursor === undefined
    ? { ok: true, data, meta: { requestId } }
    : { ok: true, data, meta: { requestId, nextCursor } };
}

export function apiFailure(requestId: string, error: ApiError): ApiResponse<never> {
  return { ok: false, error, meta: { requestId } };
}
