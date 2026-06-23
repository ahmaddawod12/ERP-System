import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/api/errors";

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiOkPayload<T> {
  ok: true;
  data: T;
}

export interface ApiFailPayload {
  ok: false;
  error: ApiErrorPayload;
}

export type ApiPayload<T> = ApiOkPayload<T> | ApiFailPayload;

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json<ApiOkPayload<T>>({ ok: true, data }, { status });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const payload: ApiFailPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return NextResponse.json<ApiFailPayload>(payload, { status });
}

export function handleRouteError(error: unknown) {
  if (error instanceof ApiRouteError) {
    return apiError(error.status, error.code, error.message, error.details);
  }

  if (error instanceof Error) {
    console.error("[api] unexpected error", error.message);
  } else {
    console.error("[api] unexpected error", error);
  }

  return apiError(500, "internal_error", "Unexpected server error");
}

