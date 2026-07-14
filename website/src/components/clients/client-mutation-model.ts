import {
  createApiResponseSchema,
  type ClientCreateRequest,
  type ClientSummary,
} from "@smart-job/api-contracts";
import type { ZodType } from "zod";

import { readCookie, WEB_CSRF_COOKIE } from "../../lib/auth/opaque-session.ts";

export interface ClientFormValues {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly city: string;
  readonly vatNumber: string;
  readonly notes: string;
}

export type ClientFormField = keyof ClientFormValues;
export type ClientFormErrors = Partial<Record<ClientFormField, string>>;

export interface PendingClientMutation {
  readonly fingerprint: string;
  readonly key: string;
}

export interface ClientMutationMessage {
  readonly kind: "error" | "success";
  readonly text: string;
  readonly stale?: boolean;
}

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  vatNumber: "",
  notes: "",
};

export class ClientMutationError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    code: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ClientMutationError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function clientCreateRequest(values: ClientFormValues): ClientCreateRequest {
  return {
    name: values.name,
    phone: nullable(values.phone),
    email: nullable(values.email),
    address: nullable(values.address),
    city: nullable(values.city),
    vatNumber: nullable(values.vatNumber),
    notes: nullable(values.notes),
  };
}

export function clientUpdateRequest(
  values: ClientFormValues,
  entityVersion: string,
) {
  return {
    entityVersion,
    ...clientCreateRequest(values),
  };
}

export function clientFormFromSummary(client: ClientSummary): ClientFormValues {
  return {
    name: client.name,
    phone: client.phone ?? "",
    email: client.email ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    vatNumber: client.vatNumber ?? "",
    notes: client.notes ?? "",
  };
}

export function clientFormErrors(
  fieldErrors: Record<string, string[] | undefined>,
): ClientFormErrors {
  const result: ClientFormErrors = {};
  for (const field of Object.keys(EMPTY_CLIENT_FORM) as ClientFormField[]) {
    const first = fieldErrors[field]?.[0];
    if (first) result[field] = first;
  }
  return result;
}

export async function sendClientMutation<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  idempotencyKey: string,
  dataSchema: ZodType<T>,
): Promise<T> {
  const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
  if (!csrfToken) {
    throw new ClientMutationError(
      "Your session could not be verified. Reload the page and try again.",
      "CSRF_REQUIRED",
    );
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-SJ-CSRF": csrfToken,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ClientMutationError(
      "The client action could not reach the server. Check your connection and retry.",
      "NETWORK_ERROR",
    );
  }

  const parsed = createApiResponseSchema(dataSchema).safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new ClientMutationError(
      "The server returned an invalid response. Reload the page and try again.",
      "INVALID_RESPONSE",
    );
  }
  if (!parsed.data.ok) {
    throw new ClientMutationError(
      parsed.data.error.message,
      parsed.data.error.code,
      parsed.data.error.fieldErrors,
    );
  }
  if (!response.ok) {
    throw new ClientMutationError(
      "The server rejected the client action.",
      "HTTP_ERROR",
    );
  }
  return parsed.data.data;
}

export function clientMutationKey(
  pending: { current: PendingClientMutation | null },
  fingerprint: string,
): string {
  if (pending.current?.fingerprint === fingerprint) {
    return pending.current.key;
  }
  const key = crypto.randomUUID();
  pending.current = { fingerprint, key };
  return key;
}
