import {
  CursorSchema,
  DEFAULT_DOCUMENT_PAGE_SIZE,
  DocumentListPageSchema,
  DocumentDetailSchema,
  DocumentSummarySchema,
  DocumentTaskSchema,
  type Cursor,
  type DocumentListQuery,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentTask,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { AppError } from "../http/errors.js";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

const databaseDecimalSchema = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^\d+(?:\.\d+)?$/),
]);

const documentAccessRowSchema = z.object({
  role: z.enum(["manager", "worker", "user", "basic", "dev"]).nullable(),
  is_dev: z.boolean(),
  documents_enabled: z.boolean(),
}).strict();

const documentRowSchema = z.object({
  document_id: z.uuid(),
  document_code: z.string(),
  document_type: z.number().int(),
  document_number: z.number().int().positive(),
  generation_status: z.enum(["pending", "queued", "processing", "completed", "failed"]),
  tax_authority_status: z.enum(["none", "reserved", "submitted", "approved", "rejected", "failed", "burned"]),
  client_id: z.uuid().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  client_city: z.string().nullable(),
  client_vat_number: z.string().nullable(),
  creator_uid: z.uuid().nullable(),
  creator_member_no: z.number().int().positive().nullable(),
  creator_display_name: z.string().nullable(),
  language: z.string().nullable(),
  notes: z.string().nullable(),
  total_before_vat: databaseDecimalSchema,
  vat_amount: databaseDecimalSchema,
  total_with_vat: databaseDecimalSchema,
  confirmation_number: z.string().nullable(),
  document_date: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  storage_path: z.string().nullable(),
  email_sent: z.boolean(),
  email_delivery_status: z.enum([
    "queued",
    "sending",
    "sent",
    "failed",
    "delivery_unknown",
  ]).nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  cursor_created_at: z.iso.datetime({ offset: true }).optional(),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

const documentTaskRowSchema = z.object({
  task_key: z.string(),
  task_type: z.enum(["preview", "generate"]),
  status: z.enum(["pending", "queued", "processing", "completed", "failed"]),
  user_id: z.uuid(),
  document_code: z.string().nullable(),
  request_payload: z.unknown(),
  preview_url: z.string().nullable(),
  generate_url: z.string().nullable(),
  storage_path: z.string().nullable(),
  pdf_size: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  processing_started_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  completed_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface DocumentRow extends QueryResultRow {
  readonly document_id: string;
  readonly document_code: string;
  readonly document_type: number;
  readonly document_number: number;
  readonly generation_status: "pending" | "queued" | "processing" | "completed" | "failed";
  readonly tax_authority_status: "none" | "reserved" | "submitted" | "approved" | "rejected" | "failed" | "burned";
  readonly client_id: string | null;
  readonly client_name: string | null;
  readonly client_phone: string | null;
  readonly client_city: string | null;
  readonly client_vat_number: string | null;
  readonly creator_uid: string | null;
  readonly creator_member_no: number | null;
  readonly creator_display_name: string | null;
  readonly language: string | null;
  readonly notes: string | null;
  readonly total_before_vat: number | string;
  readonly vat_amount: number | string;
  readonly total_with_vat: number | string;
  readonly confirmation_number: string | null;
  readonly document_date: Date | string | null;
  readonly storage_path: string | null;
  readonly email_sent: boolean;
  readonly email_delivery_status: "queued" | "sending" | "sent" | "failed" | "delivery_unknown" | null;
  readonly entity_version: bigint | number | string;
  readonly created_at: Date | string;
  readonly cursor_created_at: string;
  readonly updated_at: Date | string;
}

export interface DocumentFileRecord {
  readonly documentId: string;
  readonly documentCode: string;
  readonly objectPath: string;
}

export interface DocumentTaskRecord {
  readonly task: DocumentTask;
  readonly objectPath: string | null;
}

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is invalid.",
    fieldErrors: { afterCursor: ["Restart pagination from the first page."] },
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toDecimal(value: number | string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new TypeError("Document totals must be finite non-negative numbers");
  }
  return result;
}

function arrayFilter<T>(value: T | readonly T[] | undefined): T[] | null {
  if (value === undefined) return null;
  return [...new Set(Array.isArray(value) ? value : [value])];
}

function normalizedSearch(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized.replace(/[\\%_]/g, "\\$&") : null;
}

function numberPrefix(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? normalized : null;
}

function requestPayloadDocumentId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  for (const field of [payload.publicDocumentId, payload.documentId]) {
    if (typeof field === "string" && field.trim() && field.length <= 160) return field.trim();
  }
  return null;
}

export function mapDocumentRow(unknownRow: unknown): DocumentSummary {
  const row = documentRowSchema.parse(unknownRow);
  const client = (
    row.client_id !== null
    || row.client_name !== null
    || row.client_phone !== null
    || row.client_city !== null
    || row.client_vat_number !== null
  ) ? {
      clientId: row.client_id,
      name: row.client_name,
      phone: row.client_phone,
      city: row.client_city,
      vatNumber: row.client_vat_number,
    } : null;
  const creator = (
    row.creator_uid !== null
    || row.creator_member_no !== null
    || row.creator_display_name !== null
  ) ? {
      uid: row.creator_uid,
      memberNo: row.creator_member_no,
      displayName: row.creator_display_name,
    } : null;

  return DocumentSummarySchema.parse({
    documentId: row.document_id,
    documentCode: row.document_code,
    documentType: row.document_type,
    documentNumber: row.document_number,
    generationStatus: row.generation_status,
    taxAuthorityStatus: row.tax_authority_status,
    client,
    creator,
    language: row.language,
    notes: row.notes,
    totalBeforeVat: toDecimal(row.total_before_vat),
    vatAmount: toDecimal(row.vat_amount),
    totalWithVat: toDecimal(row.total_with_vat),
    confirmationNumber: row.confirmation_number,
    documentDate: nullableIso(row.document_date),
    hasFile: row.storage_path !== null,
    emailSent: row.email_sent,
    emailDeliveryStatus: row.email_delivery_status,
    entityVersion: encodeEntityVersion(row.entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

export function encodeDocumentListCursor(createdAt: string, id: string): Cursor {
  const payload = cursorPayloadSchema.parse({ version: 1, createdAt, id });
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

export function decodeDocumentListCursor(value: string): { createdAt: string; id: string } {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== value) throw invalidCursor();
    const payload = cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")));
    return { createdAt: payload.createdAt, id: payload.id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidCursor();
  }
}

export const READ_DOCUMENT_ACCESS_SQL = `
  SELECT
    membership.role::text AS role,
    private.app_is_dev() AS is_dev,
    COALESCE(entitlement.documents_enabled, false) AS documents_enabled
  FROM (SELECT 1) AS seed
  LEFT JOIN public.company_memberships membership
    ON membership.company_id = $1::uuid
   AND membership.user_id = private.app_auth_uid()
   AND membership.status = 'active'
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
`;

export const READ_DOCUMENT_PAGE_SQL = `
  SELECT
    document.id AS document_id,
    document.document_code,
    document.document_type,
    document.document_number,
    document.generation_status::text AS generation_status,
    document.tax_authority_status::text AS tax_authority_status,
    document.client_id,
    document.client_name_snapshot AS client_name,
    document.client_phone_snapshot AS client_phone,
    document.client_city_snapshot AS client_city,
    document.client_vat_snapshot AS client_vat_number,
    creator_user.id AS creator_uid,
    creator.member_no AS creator_member_no,
    COALESCE(creator.display_name, creator_user.display_name, creator_user.email) AS creator_display_name,
    document.language,
    document.notes,
    document.total_before_vat,
    document.vat_amount,
    document.total_with_vat,
    document.confirmation_number,
    document.document_date,
    document.storage_path,
    document.email_sent,
    private.get_api_document_email_delivery_status(
      document.company_id,
      document.id
    )::text AS email_delivery_status,
    document.entity_version,
    document.created_at,
    pg_catalog.to_char(
      document.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    document.updated_at
  FROM public.documents document
  LEFT JOIN public.company_memberships creator
    ON creator.id = document.created_by_membership_id
   AND creator.company_id = document.company_id
  LEFT JOIN public.app_users creator_user
    ON creator_user.id = creator.user_id
  WHERE document.company_id = $1::uuid
    AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
    AND (
      $2::text IS NULL
      OR document.search_text LIKE '%' || $2::text || '%' ESCAPE '\\'
      OR ($3::text IS NOT NULL AND document.document_number::text LIKE $3::text || '%' ESCAPE '\\')
    )
    AND ($4::public.document_generation_status[] IS NULL OR document.generation_status = ANY($4::public.document_generation_status[]))
    AND ($5::smallint[] IS NULL OR document.document_type = ANY($5::smallint[]))
    AND ($6::text IS NULL OR creator.user_id = $6::text)
    AND ($7::timestamptz IS NULL OR document.created_at >= $7::timestamptz)
    AND ($8::timestamptz IS NULL OR document.created_at <= $8::timestamptz)
    AND (
      $9::timestamptz IS NULL
      OR (document.created_at, document.id) < ($9::timestamptz, $10::uuid)
    )
  ORDER BY document.created_at DESC, document.id DESC
  LIMIT $11::integer
`;

export const READ_DOCUMENT_FILE_SQL = `
  SELECT document.id AS document_id, document.document_code, document.storage_path
  FROM public.documents document
  WHERE document.company_id = $1::uuid
    AND document.id = $2::uuid
    AND (document.document_type <> 305 OR document.tax_authority_status = 'approved')
  LIMIT 1
`;

export const READ_DOCUMENT_DETAIL_SQL = `
  SELECT
    document.id AS document_id,
    document.document_code,
    document.document_type,
    document.document_number,
    document.generation_status::text AS generation_status,
    document.tax_authority_status::text AS tax_authority_status,
    document.client_id,
    document.client_name_snapshot AS client_name,
    document.client_phone_snapshot AS client_phone,
    document.client_city_snapshot AS client_city,
    document.client_vat_snapshot AS client_vat_number,
    creator_user.id AS creator_uid,
    creator.member_no AS creator_member_no,
    COALESCE(creator.display_name, creator_user.display_name, creator_user.email) AS creator_display_name,
    document.language,
    document.notes,
    document.total_before_vat,
    document.vat_amount,
    document.total_with_vat,
    document.confirmation_number,
    document.document_date,
    document.storage_path,
    document.email_sent,
    private.get_api_document_email_delivery_status(document.company_id, document.id)::text
      AS email_delivery_status,
    private.get_api_tax_submission_status(document.company_id, document.id)::text
      AS tax_submission_status,
    document.entity_version,
    document.created_at,
    document.updated_at
  FROM public.documents AS document
  LEFT JOIN public.company_memberships AS creator
    ON creator.id = document.created_by_membership_id
   AND creator.company_id = document.company_id
  LEFT JOIN public.app_users AS creator_user
    ON creator_user.id = creator.user_id
  WHERE document.company_id = $1::uuid
    AND document.id = $2::uuid
  LIMIT 1
`;

export const READ_DOCUMENT_TASK_SQL = `
  SELECT
    task.task_key,
    task.task_type::text AS task_type,
    task.status::text AS status,
    task.user_id,
    document.document_code,
    task.request_payload,
    task.preview_url,
    task.generate_url,
    task.storage_path,
    task.pdf_size,
    task.error,
    task.processing_started_at,
    task.completed_at,
    task.created_at
  FROM public.document_tasks task
  LEFT JOIN public.documents document
    ON document.id = task.document_id
   AND document.company_id = task.company_id
  WHERE task.company_id = $1::uuid
    AND task.task_key = $2::text
  LIMIT 1
`;

async function assertDocumentAccess(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
): Promise<{ readonly role: string | null; readonly isDev: boolean }> {
  const result = await transaction.query(READ_DOCUMENT_ACCESS_SQL, [internalCompanyId]);
  const access = documentAccessRowSchema.parse(result.rows[0]);
  if (!access.documents_enabled) {
    throw new AppError({
      statusCode: 403,
      code: "DOCUMENTS_MODULE_DISABLED",
      message: "Documents are not enabled for this workspace.",
    });
  }
  if (!access.is_dev && !new Set(["manager", "user", "basic", "dev"]).has(access.role ?? "")) {
    throw new AppError({
      statusCode: 403,
      code: "DOCUMENTS_ACCESS_FORBIDDEN",
      message: "Documents are not available for this workspace role.",
    });
  }
  return { role: access.role, isDev: access.is_dev };
}

export async function readDocumentsPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: DocumentListQuery,
) {
  await assertDocumentAccess(transaction, internalCompanyId);
  const pageSize = query.pageSize ?? DEFAULT_DOCUMENT_PAGE_SIZE;
  const cursor = query.afterCursor === undefined
    ? null
    : decodeDocumentListCursor(query.afterCursor);
  const result = await transaction.query<DocumentRow>(READ_DOCUMENT_PAGE_SQL, [
    internalCompanyId,
    normalizedSearch(query.search),
    numberPrefix(query.search),
    arrayFilter(query.status),
    arrayFilter(query.documentType),
    query.createdByUid ?? null,
    query.dateFrom ?? null,
    query.dateTo ?? null,
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapDocumentRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeDocumentListCursor(lastRow.cursor_created_at, lastRow.document_id)
    : null;
  return DocumentListPageSchema.parse({ items, nextCursor });
}

export async function readDocumentFile(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  documentId: string,
): Promise<DocumentFileRecord> {
  await assertDocumentAccess(transaction, internalCompanyId);
  const result = await transaction.query(READ_DOCUMENT_FILE_SQL, [internalCompanyId, documentId]);
  const row = z.object({
    document_id: z.uuid(),
    document_code: z.string().trim().min(1).max(64),
    storage_path: z.string().trim().min(1).max(1024).nullable(),
  }).strict().optional().parse(result.rows[0]);
  if (!row) {
    throw new AppError({ statusCode: 404, code: "DOCUMENT_NOT_FOUND", message: "Document not found." });
  }
  if (!row.storage_path) {
    throw new AppError({
      statusCode: 409,
      code: "DOCUMENT_FILE_UNAVAILABLE",
      message: "The generated document file is not available yet.",
      retryable: true,
    });
  }
  const expectedPrefix = `${internalCompanyId}/documents/`;
  if (!row.storage_path.startsWith(expectedPrefix)) {
    throw new AppError({
      statusCode: 409,
      code: "DOCUMENT_FILE_INVALID",
      message: "The generated document file is unavailable.",
    });
  }
  return {
    documentId: row.document_id,
    documentCode: row.document_code,
    objectPath: row.storage_path,
  };
}

export async function readDocumentDetail(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  documentId: string,
): Promise<DocumentDetail> {
  await assertDocumentAccess(transaction, internalCompanyId);
  const result = await transaction.query(READ_DOCUMENT_DETAIL_SQL, [internalCompanyId, documentId]);
  const row = documentRowSchema.extend({
    tax_submission_status: z.enum([
      "queued",
      "submitting",
      "submitted",
      "approved",
      "rejected",
      "failed",
      "submission_unknown",
    ]).nullable(),
  }).strict().optional().parse(result.rows[0]);
  if (!row) {
    throw new AppError({ statusCode: 404, code: "DOCUMENT_NOT_FOUND", message: "Document not found." });
  }
  const { tax_submission_status: taxSubmissionStatus, ...summaryRow } = row;
  return DocumentDetailSchema.parse({
    ...mapDocumentRow(summaryRow),
    taxSubmissionStatus,
  });
}

export async function readDocumentTask(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  viewerUid: string,
  taskId: string,
): Promise<DocumentTaskRecord> {
  const access = await assertDocumentAccess(transaction, internalCompanyId);
  const result = await transaction.query(READ_DOCUMENT_TASK_SQL, [internalCompanyId, taskId]);
  const row = documentTaskRowSchema.optional().parse(result.rows[0]);
  if (!row) {
    throw new AppError({ statusCode: 404, code: "DOCUMENT_TASK_NOT_FOUND", message: "Document task not found." });
  }
  if (row.user_id !== viewerUid && !access.isDev && access.role !== "manager") {
    throw new AppError({
      statusCode: 403,
      code: "DOCUMENT_TASK_ACCESS_FORBIDDEN",
      message: "This document task is not available to the current user.",
    });
  }
  const documentId = row.document_code ?? requestPayloadDocumentId(row.request_payload);
  const updatedAt = row.completed_at ?? row.processing_started_at ?? row.created_at;
  return {
    task: DocumentTaskSchema.parse({
      taskId: row.task_key,
      taskType: row.task_type,
      status: row.status,
      documentId,
      // Stored task URLs are short-lived historical values. The HTTP route
      // signs the canonical object path again for every authorized read.
      previewURL: null,
      downloadURL: null,
      pdfSize: row.pdf_size,
      error: row.error,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(updatedAt),
    }),
    objectPath: row.storage_path,
  };
}
