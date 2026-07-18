import {
  createApiResponseSchema,
  DocumentTaskAcceptedSchema,
  DocumentTaskSchema,
  type DocumentTask,
  type DocumentTaskAccepted,
} from "@smart-job/api-contracts";
import { z, type ZodType } from "zod";

import { readCookie, WEB_CSRF_COOKIE } from "../../lib/auth/opaque-session.ts";

export interface PendingDocumentMutation {
  readonly fingerprint: string;
  readonly key: string;
  readonly accepted?: DocumentTaskAccepted;
}

export type DocumentTaskAction = "preview" | "generate";

const persistedDocumentMutationSchema = z.object({
  version: z.literal(1),
  companyId: z.number().int().positive(),
  action: z.enum(["preview", "generate"]),
  fingerprint: z.string().min(1),
  idempotencyKey: z.string().trim().min(8).max(128),
  accepted: DocumentTaskAcceptedSchema.nullable(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type PersistedDocumentMutation = z.infer<typeof persistedDocumentMutationSchema>;

function documentTaskAttemptStorageKey(companyId: number, action: DocumentTaskAction): string {
  return `sj_document_task_attempt:v1:${companyId}:${action}`;
}

export function readPersistedDocumentMutation(
  storage: Pick<Storage, "getItem" | "removeItem">,
  companyId: number,
  action: DocumentTaskAction,
): PersistedDocumentMutation | null {
  const key = documentTaskAttemptStorageKey(companyId, action);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = persistedDocumentMutationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.companyId !== companyId || parsed.data.action !== action) {
      storage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function persistDocumentMutation(
  storage: Pick<Storage, "setItem">,
  companyId: number,
  action: DocumentTaskAction,
  pending: PendingDocumentMutation,
  updatedAt = Date.now(),
): PersistedDocumentMutation {
  const record = persistedDocumentMutationSchema.parse({
    version: 1,
    companyId,
    action,
    fingerprint: pending.fingerprint,
    idempotencyKey: pending.key,
    accepted: pending.accepted ?? null,
    updatedAt,
  });
  storage.setItem(documentTaskAttemptStorageKey(companyId, action), JSON.stringify(record));
  return record;
}

export function clearPersistedDocumentMutation(
  storage: Pick<Storage, "removeItem">,
  companyId: number,
  action: DocumentTaskAction,
): void {
  try {
    storage.removeItem(documentTaskAttemptStorageKey(companyId, action));
  } catch {
    // Terminal reconciliation must not fail because browser storage is unavailable.
  }
}

export interface DocumentComposerItem {
  readonly description: string;
  readonly quantity: number;
  readonly price: number;
}

export interface DocumentComposerValues {
  readonly documentType: number;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly clientPhone: string;
  readonly clientAddress: string;
  readonly clientCity: string;
  readonly clientVatNumber: string;
  readonly language: "he" | "ar" | "en";
  readonly date: string;
  readonly notes: string;
  readonly items: readonly DocumentComposerItem[];
}

export class DocumentMutationError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    code: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DocumentMutationError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function documentRequestFromComposer(values: DocumentComposerValues) {
  return {
    documentType: values.documentType,
    documentData: {
      client: {
        name: values.clientName.trim(),
        ...(optional(values.clientEmail) ? { email: optional(values.clientEmail) } : {}),
        ...(optional(values.clientPhone) ? { phone: optional(values.clientPhone) } : {}),
        ...(optional(values.clientAddress) ? { address: optional(values.clientAddress) } : {}),
        ...(optional(values.clientCity) ? { city: optional(values.clientCity) } : {}),
        ...(optional(values.clientVatNumber)
          ? { clientVatNumber: optional(values.clientVatNumber) }
          : {}),
      },
      items: values.items.map((item) => ({
        description: item.description.trim(),
        quantity: item.quantity,
        price: item.price,
      })),
      language: values.language,
      date: values.date,
      ...(optional(values.notes) ? { notes: optional(values.notes) } : {}),
    },
  };
}

export async function sendDocumentMutation<T>(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
  idempotencyKey: string,
  dataSchema: ZodType<T>,
): Promise<T> {
  const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
  if (!csrfToken) {
    throw new DocumentMutationError(
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
    throw new DocumentMutationError(
      "The document action could not reach the server. Check your connection and retry.",
      "NETWORK_ERROR",
    );
  }

  const parsed = createApiResponseSchema(dataSchema).safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new DocumentMutationError(
      "The server returned an invalid response. Reload the page and try again.",
      "INVALID_RESPONSE",
    );
  }
  if (!parsed.data.ok) {
    throw new DocumentMutationError(
      parsed.data.error.message,
      parsed.data.error.code,
      parsed.data.error.fieldErrors,
    );
  }
  if (!response.ok) {
    throw new DocumentMutationError("The server rejected the document action.", "HTTP_ERROR");
  }
  return parsed.data.data;
}

export async function readWebsiteDocumentTask(
  companyId: number,
  taskId: string,
  signal?: AbortSignal,
): Promise<DocumentTask> {
  let response: Response;
  try {
    response = await fetch(
      `/api/companies/${companyId}/document-tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DocumentMutationError(
      "The document task could not be checked. Check your connection and retry.",
      "NETWORK_ERROR",
    );
  }
  const parsed = createApiResponseSchema(DocumentTaskSchema).safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new DocumentMutationError("The server returned an invalid task response.", "INVALID_RESPONSE");
  }
  if (!parsed.data.ok) {
    throw new DocumentMutationError(parsed.data.error.message, parsed.data.error.code);
  }
  if (!response.ok) {
    throw new DocumentMutationError("The server rejected the task request.", "HTTP_ERROR");
  }
  return parsed.data.data;
}

export function documentMutationKey(
  pending: { current: PendingDocumentMutation | null },
  fingerprint: string,
): string {
  if (pending.current?.fingerprint === fingerprint) return pending.current.key;
  const key = crypto.randomUUID();
  pending.current = { fingerprint, key };
  return key;
}
