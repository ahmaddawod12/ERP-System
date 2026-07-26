import {
  ArchiveDataTypeSchema,
  ArchiveListPageSchema,
  ArchiveRunStatusSchema,
  ArchiveRunSummarySchema,
  CursorSchema,
  type ArchiveDataType,
  type ArchiveListPage,
  type ArchiveRunSummary,
  type Cursor,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

const DEFAULT_ARCHIVE_PAGE_SIZE = 50;
const MAX_ARCHIVE_PAGE_SIZE = 200;

const archiveRowSchema = z.object({
  id: z.uuid(),
  archive_key: z.string().trim().min(1).max(64),
  data_type: ArchiveDataTypeSchema,
  status: ArchiveRunStatusSchema,
  period_start: z.union([z.date(), z.iso.datetime({ offset: true })]),
  period_end: z.union([z.date(), z.iso.datetime({ offset: true })]),
  segment: z.number().int().positive(),
  doc_count: z.number().int().nonnegative(),
  deleted_count: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  storage_generation: z.union([
    z.string().regex(/^[1-9][0-9]*$/),
    z.bigint().positive(),
  ]).nullable(),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  completed_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

export interface ArchiveRepositoryListQuery {
  readonly dataType?: ArchiveDataType;
  readonly year?: number;
  readonly month?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
}

const LIST_ARCHIVES_SQL = `
  SELECT *
  FROM private.list_api_company_archives_v2(
    $1::uuid,
    $2::varchar(32),
    $3::timestamptz,
    $4::timestamptz,
    $5::integer,
    $6::timestamptz,
    $7::uuid
  )
`;

export const READ_ARCHIVE_DOWNLOAD_SQL = `
  SELECT *
  FROM private.get_api_company_archive_run($1::uuid, $2::uuid)
`;

const archiveDownloadRowSchema = z.object({
  id: z.uuid(),
  archive_key: z.string().trim().min(1).max(64),
  data_type: ArchiveDataTypeSchema,
  status: ArchiveRunStatusSchema,
  period_start: z.union([z.date(), z.iso.datetime({ offset: true })]),
  period_end: z.union([z.date(), z.iso.datetime({ offset: true })]),
  segment: z.number().int().positive(),
  storage_path: z.string().trim().min(1).max(1_024).nullable(),
  checksum: z.string().trim().min(1).max(128).nullable(),
  storage_generation: z.union([
    z.string().regex(/^[1-9][0-9]*$/),
    z.bigint().positive(),
  ]).nullable(),
}).strict();

function encodeCursor(createdAt: string, id: string): string {
  const payload = JSON.stringify(cursorPayloadSchema.parse({ version: 1, createdAt, id }));
  return Buffer.from(payload, "utf8").toString("base64url");
}

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is malformed.",
  });
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== cursor) {
      throw invalidCursor();
    }
    const parsed = cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidCursor();
  }
}

interface ArchiveDatabaseRow extends QueryResultRow {
  readonly id: string;
  readonly archive_key: string;
  readonly data_type: ArchiveDataType;
  readonly status: "pending" | "uploaded_not_deleted" | "deleted" | "failed";
  readonly period_start: Date | string;
  readonly period_end: Date | string;
  readonly segment: number;
  readonly doc_count: number;
  readonly deleted_count: number;
  readonly checksum: string | null;
  readonly storage_generation: string | bigint | null;
  readonly created_at: Date | string;
  readonly completed_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

export async function readArchivesPage(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly dataType?: ArchiveDataType;
    readonly year?: number;
    readonly month?: number;
    readonly pageSize?: number;
    readonly cursor?: string;
  },
): Promise<ArchiveListPage> {
  const pageSize = Math.min(
    Math.max(input.pageSize ?? DEFAULT_ARCHIVE_PAGE_SIZE, 1),
    MAX_ARCHIVE_PAGE_SIZE,
  );
  const cursor = input.cursor !== undefined ? decodeCursor(input.cursor) : { createdAt: undefined, id: undefined };
  const hasPeriod = input.year !== undefined && input.month !== undefined;
  const periodStart = hasPeriod
    ? new Date(Date.UTC(input.year!, input.month! - 1, 1))
    : null;
  const periodEnd = hasPeriod
    ? new Date(Date.UTC(input.year!, input.month!, 1))
    : null;

  const result = await transaction.query<ArchiveDatabaseRow>(LIST_ARCHIVES_SQL, [
    input.internalCompanyId,
    input.dataType ?? null,
    periodStart,
    periodEnd,
    pageSize,
    cursor.createdAt ?? null,
    cursor.id ?? null,
  ]);

  const rows = result.rows.map((row) => {
    const parsed = archiveRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new AppError({
        statusCode: 500,
        code: "ARCHIVE_DATA_INVALID",
        message: "An archive record did not match the expected schema.",
        retryable: true,
      });
    }
    return parsed.data;
  });

  let nextCursor: Cursor | null = null;
  const items = rows.slice(0, pageSize).map((row): ArchiveRunSummary => ArchiveRunSummarySchema.parse({
    archiveRunId: row.id,
    archiveKey: row.archive_key,
    dataType: row.data_type,
    status: row.status,
    periodStart: toIso(row.period_start),
    periodEnd: toIso(row.period_end),
    segment: row.segment,
    docCount: row.doc_count,
    deletedCount: row.deleted_count,
    checksum: row.checksum,
    storageGeneration: row.storage_generation === null
      ? null
      : String(row.storage_generation),
    createdAt: toIso(row.created_at),
    completedAt: nullableIso(row.completed_at),
  }));

  if (rows.length > pageSize && items.length > 0) {
    const last = rows[pageSize - 1]!;
    if (last !== undefined) {
      nextCursor = encodeCursor(toIso(last.created_at), last.id) as Cursor;
    }
  }

  return ArchiveListPageSchema.parse({ items, nextCursor });
}

export async function readArchiveDownloadRecord(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  archiveRunId: string,
) {
  const result = await transaction.query(READ_ARCHIVE_DOWNLOAD_SQL, [
    internalCompanyId,
    archiveRunId,
  ]);
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) {
    throw new AppError({
      statusCode: 404,
      code: "ARCHIVE_NOT_FOUND",
      message: "The requested archive was not found.",
    });
  }
  const row = archiveDownloadRowSchema.parse(unknownRow);
  if (
    (row.status !== "uploaded_not_deleted" && row.status !== "deleted")
    || row.storage_path === null
  ) {
    throw new AppError({
      statusCode: 409,
      code: "ARCHIVE_NOT_READY",
      message: "The requested archive is not ready for download.",
      retryable: row.status === "pending",
    });
  }
  if (row.checksum === null || row.storage_generation === null) {
    throw new AppError({
      statusCode: 409,
      code: "ARCHIVE_INTEGRITY_FAILURE",
      message: "The archive ledger is missing required integrity metadata.",
    });
  }
  return {
    archiveRunId: row.id,
    archiveKey: row.archive_key,
    dataType: row.data_type,
    periodStart: toIso(row.period_start),
    periodEnd: toIso(row.period_end),
    segment: row.segment,
    objectPath: row.storage_path,
    checksum: row.checksum,
    storageGeneration: String(row.storage_generation),
  } as const;
}

export { CursorSchema };
