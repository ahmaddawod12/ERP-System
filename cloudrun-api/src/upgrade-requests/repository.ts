import {
  CursorSchema,
  UpgradeRequestListPageSchema,
  UpgradeRequestSummarySchema,
  type Cursor,
  type UpgradeRequestCreateRequest,
  type UpgradeRequestListQuery,
  type UpgradeRequestModerationRequest,
  type UpgradeRequestSummary,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { AppError } from "../http/errors.js";

const DEFAULT_PAGE_SIZE = 50;
const exactTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
);
const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const integerValueSchema = z.union([
  z.bigint(),
  z.number().int(),
  z.string().regex(/^\d+$/),
]);
const upgradeRequestRowSchema = z.object({
  request_id: z.uuid(),
  requester_uid: z.uuid(),
  requester_email: z.string().nullable(),
  public_company_id: z.union([z.string(), z.number()]),
  role: z.string(),
  current_tier: z.string(),
  requested_tier: z.string(),
  message: z.string(),
  status: z.string(),
  moderation_note: z.string().nullable(),
  moderated_at: dateValueSchema.nullable(),
  moderated_by_name: z.string().nullable(),
  applied_at: dateValueSchema.nullable(),
  entity_version: integerValueSchema,
  created_at: dateValueSchema,
  updated_at: dateValueSchema,
  cursor_created_at: exactTimestampSchema,
}).strict();
const cursorPayloadSchema = z.object({
  version: z.literal(1),
  createdAt: exactTimestampSchema,
  id: z.uuid(),
}).strict();

interface UpgradeRequestRow extends QueryResultRow {
  readonly request_id: string;
  readonly requester_uid: string;
  readonly requester_email: string | null;
  readonly public_company_id: string | number;
  readonly role: string;
  readonly current_tier: string;
  readonly requested_tier: string;
  readonly message: string;
  readonly status: string;
  readonly moderation_note: string | null;
  readonly moderated_at: Date | string | null;
  readonly moderated_by_name: string | null;
  readonly applied_at: Date | string | null;
  readonly entity_version: bigint | number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly cursor_created_at: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function publicCompanyId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Database returned an invalid public company id");
  }
  return parsed;
}

function mapRow(unknownRow: unknown): UpgradeRequestSummary {
  const row = upgradeRequestRowSchema.parse(unknownRow);
  return UpgradeRequestSummarySchema.parse({
    requestId: row.request_id,
    requesterUid: row.requester_uid,
    requesterEmail: row.requester_email,
    companyId: publicCompanyId(row.public_company_id),
    role: row.role,
    currentTier: row.current_tier,
    requestedTier: row.requested_tier,
    message: row.message,
    status: row.status,
    moderationNote: row.moderation_note,
    moderatedAt: row.moderated_at === null ? null : toIso(row.moderated_at),
    moderatedByName: row.moderated_by_name,
    appliedAt: row.applied_at === null ? null : toIso(row.applied_at),
    entityVersion: encodeEntityVersion(row.entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is invalid.",
    fieldErrors: { afterCursor: ["Restart pagination from the first page."] },
  });
}

function decodeCursor(cursor: Cursor | undefined): z.infer<typeof cursorPayloadSchema> | null {
  if (cursor === undefined) return null;
  try {
    return cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw invalidCursor();
  }
}

function encodeCursor(value: z.infer<typeof cursorPayloadSchema>): Cursor {
  return CursorSchema.parse(
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url"),
  );
}

export async function readUpgradeRequest(
  transaction: DatabaseQueryable,
  requestId: string,
): Promise<UpgradeRequestSummary> {
  const result = await transaction.query<UpgradeRequestRow>(
    `SELECT * FROM private.read_api_upgrade_request($1::uuid)`,
    [requestId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new AppError({
      statusCode: 404,
      code: "UPGRADE_REQUEST_NOT_FOUND",
      message: "The upgrade request was not found.",
    });
  }
  return mapRow(row);
}

export async function listUpgradeRequests(
  transaction: DatabaseQueryable,
  query: UpgradeRequestListQuery,
): Promise<z.infer<typeof UpgradeRequestListPageSchema>> {
  const cursor = decodeCursor(query.afterCursor);
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const result = await transaction.query<UpgradeRequestRow>(
    `SELECT *
     FROM private.list_api_upgrade_requests(
       $1::text,
       $2::timestamptz,
       $3::uuid,
       $4::integer
     )`,
    [query.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, pageSize + 1],
  );
  const hasMore = result.rows.length > pageSize;
  const pageRows = result.rows.slice(0, pageSize);
  const lastRow = pageRows.at(-1);
  return UpgradeRequestListPageSchema.parse({
    items: pageRows.map(mapRow),
    nextCursor: hasMore && lastRow !== undefined
      ? encodeCursor({
          version: 1,
          createdAt: lastRow.cursor_created_at,
          id: lastRow.request_id,
        })
      : null,
  });
}

export async function createUpgradeRequest(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: UpgradeRequestCreateRequest;
  },
): Promise<UpgradeRequestSummary> {
  const created = await transaction.query<{ request_id: string } & QueryResultRow>(
    `SELECT private.create_api_upgrade_request($1::uuid, $2::text, $3::text) AS request_id`,
    [input.internalCompanyId, input.request.requestedTier, input.request.message],
  );
  const requestId = z.object({ request_id: z.uuid() }).strict().parse(
    created.rows[0],
  ).request_id;
  return readUpgradeRequest(transaction, requestId);
}

export async function moderateUpgradeRequest(
  transaction: DatabaseQueryable,
  input: {
    readonly requestId: string;
    readonly expectedEntityVersion: bigint;
    readonly request: UpgradeRequestModerationRequest;
  },
): Promise<UpgradeRequestSummary> {
  await transaction.query(
    `SELECT private.moderate_api_upgrade_request(
       $1::uuid,
       $2::text,
       $3::text,
       $4::bigint
     )`,
    [
      input.requestId,
      input.request.status,
      input.request.moderationNote ?? null,
      input.expectedEntityVersion.toString(),
    ],
  );
  return readUpgradeRequest(transaction, input.requestId);
}
