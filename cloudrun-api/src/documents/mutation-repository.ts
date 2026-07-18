import {
  DocumentDeleteResultSchema,
  DocumentEmailRetryResultSchema,
  DocumentTaskAcceptedSchema,
  type DocumentDeleteResult,
  type DocumentEmailRetryResult,
  type DocumentGenerateRequest,
  type DocumentPreviewRequest,
  type DocumentTaskAccepted,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const taskMutationRowSchema = z.object({
  task_key: z.string().trim().min(1).max(160),
  task_status: z.enum(["pending", "queued"]),
  document_id: z.uuid().nullable(),
  document_code: z.string().trim().min(1).max(64).nullable(),
  entity_version: z.union([
    z.string(),
    z.number().int().positive(),
    z.bigint().positive(),
  ]).nullable(),
  dispatch_payload: z.unknown(),
}).strict();

interface TaskMutationRow extends QueryResultRow {
  readonly task_key: string;
  readonly task_status: "pending" | "queued";
  readonly document_id: string | null;
  readonly document_code: string | null;
  readonly entity_version: bigint | number | string | null;
  readonly dispatch_payload: unknown;
}

const deleteRowSchema = z.object({
  document_id: z.uuid(),
  document_code: z.string().trim().min(1).max(64),
}).strict();

interface DeleteRow extends QueryResultRow {
  readonly document_id: string;
  readonly document_code: string;
}

const emailRetryRowSchema = z.object({
  delivery_id: z.uuid(),
  document_id: z.uuid(),
  delivery_status: z.literal("queued"),
}).strict();

interface EmailRetryRow extends QueryResultRow {
  readonly delivery_id: string;
  readonly document_id: string;
  readonly delivery_status: "queued";
}

export const CREATE_DOCUMENT_PREVIEW_TASK_SQL = `
  SELECT *
  FROM private.create_api_document_preview_task(
    $1::uuid,
    $2::smallint,
    $3::jsonb,
    $4::timestamptz
  )
`;

export const CREATE_DOCUMENT_GENERATION_TASK_SQL = `
  SELECT *
  FROM private.create_api_document_generation_task(
    $1::uuid,
    $2::smallint,
    $3::jsonb,
    $4::timestamptz
  )
`;

export const DELETE_DOCUMENT_SQL = `
  SELECT *
  FROM private.delete_api_document($1::uuid, $2::uuid, $3::bigint)
`;

export const RETRY_DOCUMENT_EMAIL_SQL = `
  SELECT * FROM private.retry_api_document_email($1::uuid, $2::uuid)
`;

function mapTaskMutationRow(unknownRow: unknown): DocumentTaskAccepted {
  const row = taskMutationRowSchema.parse(unknownRow);
  return DocumentTaskAcceptedSchema.parse({
    taskId: row.task_key,
    status: row.task_status,
    documentId: row.document_id,
    documentCode: row.document_code,
    entityVersion: row.entity_version === null ? null : encodeEntityVersion(row.entity_version),
  });
}

async function createTask(
  transaction: DatabaseQueryable,
  sql: string,
  input: {
    readonly internalCompanyId: string;
    readonly request: DocumentPreviewRequest | DocumentGenerateRequest;
    readonly createdAt: Date;
  },
): Promise<DocumentTaskAccepted> {
  const result = await transaction.query<TaskMutationRow>(sql, [
    input.internalCompanyId,
    input.request.documentType,
    JSON.stringify(input.request.documentData),
    input.createdAt,
  ]);
  return mapTaskMutationRow(result.rows[0]);
}

export async function createDocumentPreviewTask(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: DocumentPreviewRequest;
    readonly createdAt: Date;
  },
): Promise<DocumentTaskAccepted> {
  return createTask(transaction, CREATE_DOCUMENT_PREVIEW_TASK_SQL, input);
}

export async function createDocumentGenerationTask(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: DocumentGenerateRequest;
    readonly createdAt: Date;
  },
): Promise<DocumentTaskAccepted> {
  return createTask(transaction, CREATE_DOCUMENT_GENERATION_TASK_SQL, input);
}

export async function deleteDocument(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly documentId: string;
    readonly expectedEntityVersion: bigint;
  },
): Promise<DocumentDeleteResult> {
  const result = await transaction.query<DeleteRow>(DELETE_DOCUMENT_SQL, [
    input.internalCompanyId,
    input.documentId,
    input.expectedEntityVersion.toString(),
  ]);
  const row = deleteRowSchema.parse(result.rows[0]);
  return DocumentDeleteResultSchema.parse({
    documentId: row.document_id,
    documentCode: row.document_code,
    disposition: "deleted",
  });
}

export async function retryDocumentEmail(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly documentId: string;
  },
): Promise<DocumentEmailRetryResult> {
  const result = await transaction.query<EmailRetryRow>(RETRY_DOCUMENT_EMAIL_SQL, [
    input.internalCompanyId,
    input.documentId,
  ]);
  const row = emailRetryRowSchema.parse(result.rows[0]);
  return DocumentEmailRetryResultSchema.parse({
    documentId: row.document_id,
    deliveryId: row.delivery_id,
    emailDeliveryStatus: row.delivery_status,
  });
}
