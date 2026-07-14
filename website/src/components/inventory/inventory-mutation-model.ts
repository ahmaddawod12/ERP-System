import {
  createApiResponseSchema,
  type EntityVersion,
  type InventoryPartCreateRequest,
  type InventoryPartSummary,
  type InventoryPartUpdateRequest,
} from "@smart-job/api-contracts";
import type { ZodType } from "zod";

import { readCookie, WEB_CSRF_COOKIE } from "../../lib/auth/opaque-session.ts";

export interface InventoryPartFormValues {
  readonly name: string;
  readonly quantity: string;
  readonly lowThreshold: string;
  readonly unit: string;
  readonly active: boolean;
}

export type InventoryPartFormField = keyof InventoryPartFormValues;
export type InventoryPartFormErrors = Partial<Record<InventoryPartFormField, string>>;

export interface PendingInventoryMutation {
  readonly fingerprint: string;
  readonly key: string;
}

export interface InventoryMutationMessage {
  readonly kind: "error" | "success";
  readonly text: string;
  readonly stale?: boolean;
}

export const EMPTY_INVENTORY_PART_FORM: InventoryPartFormValues = {
  name: "",
  quantity: "0",
  lowThreshold: "0",
  unit: "",
  active: true,
};

export class InventoryMutationError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    code: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "InventoryMutationError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function quantity(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : Number(normalized);
}

export function inventoryPartCreateRequest(
  values: InventoryPartFormValues,
): InventoryPartCreateRequest {
  return {
    name: values.name,
    initialQuantity: quantity(values.quantity),
    lowThreshold: quantity(values.lowThreshold),
    unit: nullable(values.unit),
  };
}

export function inventoryPartUpdateRequest(
  values: InventoryPartFormValues,
  entityVersion: EntityVersion,
): InventoryPartUpdateRequest {
  return {
    entityVersion,
    name: values.name,
    active: values.active,
    lowThreshold: quantity(values.lowThreshold),
    unit: nullable(values.unit),
  };
}

export function inventoryPartFormFromSummary(
  part: InventoryPartSummary,
): InventoryPartFormValues {
  return {
    name: part.name,
    quantity: String(part.quantity),
    lowThreshold: String(part.lowThreshold),
    unit: part.unit ?? "",
    active: part.active,
  };
}

export function inventoryPartFormErrors(
  fieldErrors: Record<string, string[] | undefined>,
): InventoryPartFormErrors {
  return {
    name: fieldErrors.name?.[0],
    quantity: fieldErrors.initialQuantity?.[0] ?? fieldErrors.quantityDelta?.[0],
    lowThreshold: fieldErrors.lowThreshold?.[0],
    unit: fieldErrors.unit?.[0],
    active: fieldErrors.active?.[0],
  };
}

export async function sendInventoryMutation<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  idempotencyKey: string,
  dataSchema: ZodType<T>,
): Promise<T> {
  const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
  if (!csrfToken) {
    throw new InventoryMutationError(
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
    throw new InventoryMutationError(
      "The inventory action could not reach the server. Check your connection and retry.",
      "NETWORK_ERROR",
    );
  }

  const parsed = createApiResponseSchema(dataSchema).safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new InventoryMutationError(
      "The server returned an invalid response. Reload the page and try again.",
      "INVALID_RESPONSE",
    );
  }
  if (!parsed.data.ok) {
    throw new InventoryMutationError(
      parsed.data.error.message,
      parsed.data.error.code,
      parsed.data.error.fieldErrors,
    );
  }
  if (!response.ok) {
    throw new InventoryMutationError(
      "The server rejected the inventory action.",
      "HTTP_ERROR",
    );
  }
  return parsed.data.data;
}

export function inventoryMutationKey(
  pending: { current: PendingInventoryMutation | null },
  fingerprint: string,
): string {
  if (pending.current?.fingerprint === fingerprint) {
    return pending.current.key;
  }
  const key = crypto.randomUUID();
  pending.current = { fingerprint, key };
  return key;
}
