import { CursorSchema, type Cursor } from "@smart-job/api-contracts";
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
  archive_key: z.string().trim().min(1).max(32),
  data_type: z.string().trim().min(1).max(32),
  status: z.enum(["pending", "uploaded_not_deleted", "deleted", "failed"]),
  doc_count: z.number().int().nonnegative(),
  deleted_count: z.number().int().nonnegative(),
  storage_path: z.string().nullable(),
  checksum: z.string().nullable(),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  completed_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

export interface ArchiveSummary {
  readonly archiveKey: string;
  readonly dataType: string;
  readonly status: "pending" | "uploaded_not_deleted" | "deleted" | "failed";
  readonly docCount: number;
  readonly deletedCount: number;
  readonly storagePath: string | null;
  readonly checksum: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface ArchiveListQuery {
  readonly dataType?: string;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ArchiveListPage {
  readonly items: readonly ArchiveSummary[];
  readonly nextCursor: Cursor | null;
}

const LIST_ARCHIVES_SQL = `
  SELECT *
  FROM private.list_api_company_archives(
    $1::uuid,
    $2::varchar(32),
    $3::integer,
    $4::timestamptz,
    $5::uuid
  )
`;

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
  readonly data_type: string;
  readonly status: string;
  readonly doc_count: number;
  readonly deleted_count: number;
  readonly storage_path: string | null;
  readonly checksum: string | null;
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
    readonly dataType?: string;
    readonly pageSize?: number;
    readonly cursor?: string;
  },
): Promise<ArchiveListPage> {
  const pageSize = Math.min(
    Math.max(input.pageSize ?? DEFAULT_ARCHIVE_PAGE_SIZE, 1),
    MAX_ARCHIVE_PAGE_SIZE,
  );
  const cursor = input.cursor !== undefined ? decodeCursor(input.cursor) : { createdAt: undefined, id: undefined };

  const result = await transaction.query<ArchiveDatabaseRow>(LIST_ARCHIVES_SQL, [
    input.internalCompanyId,
    input.dataType ?? null,
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
  const items = rows.slice(0, pageSize).map((row): ArchiveSummary => ({
    archiveKey: row.archive_key,
    dataType: row.data_type,
    status: row.status,
    docCount: row.doc_count,
    deletedCount: row.deleted_count,
    storagePath: row.storage_path,
    checksum: row.checksum,
    createdAt: toIso(row.created_at),
    completedAt: nullableIso(row.completed_at),
  }));

  if (rows.length > pageSize && items.length > 0) {
    const last = rows[pageSize - 1]!;
    if (last !== undefined) {
      nextCursor = encodeCursor(toIso(last.created_at), last.id) as Cursor;
    }
  }

  return { items, nextCursor };
}

export { CursorSchema };
