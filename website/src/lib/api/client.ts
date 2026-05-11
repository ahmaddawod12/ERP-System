export interface ClientApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ClientApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ClientApiError;
    };

export function getClientApiErrorMessage(
  payload: ClientApiResponse<unknown>,
  fallback: string,
) {
  if (!payload.ok && payload.error?.message) {
    return payload.error.message;
  }
  return fallback;
}

