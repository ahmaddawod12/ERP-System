import {
  CursorSchema,
  DEFAULT_INVENTORY_PAGE_SIZE,
  InventoryListPageSchema,
  InventoryPartStatusSchema,
  InventoryPartSummarySchema,
  type Cursor,
  type InventoryListQuery,
  type InventoryPartStatus,
  type InventoryPartSummary,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { AppError } from "../http/errors.js";

export type InventoryReadScope = "company" | "member";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

const databaseDecimalSchema = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^\d+(?:\.\d+)?$/),
]);

const inventoryAccessRowSchema = z.object({
  role: z.enum(["manager", "worker", "user", "basic", "dev"]).nullable(),
  membership_id: z.uuid().nullable(),
  is_dev: z.boolean(),
  inventory_enabled: z.boolean(),
}).strict();

const managedMemberInventoryAccessRowSchema = z.object({
  role: z.enum(["manager", "worker", "user", "basic", "dev"]).nullable(),
  is_dev: z.boolean(),
  inventory_enabled: z.boolean(),
  target_membership_id: z.uuid().nullable(),
}).strict();

const inventoryPartRowSchema = z.object({
  part_id: z.uuid(),
  part_no: z.number().int().positive(),
  status: InventoryPartStatusSchema,
  name: z.string(),
  active: z.boolean(),
  quantity_on_hand: databaseDecimalSchema,
  low_threshold: databaseDecimalSchema,
  unit: z.string().nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  stock_entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  cursor_created_at: z.iso.datetime({ offset: true }),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  archived_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

interface InventoryPartRow extends QueryResultRow {
  readonly part_id: string;
  readonly part_no: number;
  readonly status: InventoryPartStatus;
  readonly name: string;
  readonly active: boolean;
  readonly quantity_on_hand: number | string;
  readonly low_threshold: number | string;
  readonly unit: string | null;
  readonly entity_version: bigint | number | string;
  readonly stock_entity_version: bigint | number | string;
  readonly created_at: Date | string;
  readonly cursor_created_at: string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
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

function toDecimalNumber(value: number | string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new TypeError("Inventory quantities must be finite non-negative numbers");
  }
  return result;
}

function mapInventoryPartRow(unknownRow: unknown): InventoryPartSummary {
  const row = inventoryPartRowSchema.parse(unknownRow);
  return InventoryPartSummarySchema.parse({
    partId: row.part_id,
    partNo: row.part_no,
    status: row.status,
    name: row.name,
    active: row.active,
    quantity: toDecimalNumber(row.quantity_on_hand),
    lowThreshold: toDecimalNumber(row.low_threshold),
    unit: row.unit,
    entityVersion: encodeEntityVersion(row.entity_version),
    stockEntityVersion: encodeEntityVersion(row.stock_entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    archivedAt: nullableIso(row.archived_at),
  });
}

export function encodeInventoryListCursor(createdAt: string, id: string): Cursor {
  const payload = cursorPayloadSchema.parse({
    version: 1,
    createdAt,
    id,
  });
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

export function decodeInventoryListCursor(value: string): { createdAt: string; id: string } {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== value) {
      throw invalidCursor();
    }
    const payload = cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")));
    return { createdAt: payload.createdAt, id: payload.id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidCursor();
  }
}

function escapeLikePattern(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized.replace(/[\\%_]/g, "\\$&") : null;
}

function normalizedStatuses(
  value: InventoryListQuery["status"],
): InventoryPartStatus[] | null {
  if (value === undefined) return null;
  return [...new Set(Array.isArray(value) ? value : [value])];
}

export const READ_INVENTORY_ACCESS_SQL = `
  SELECT
    membership.role::text AS role,
    membership.id AS membership_id,
    private.app_is_dev() AS is_dev,
    COALESCE(entitlement.inventory_enabled, false) AS inventory_enabled
  FROM (SELECT 1) AS seed
  LEFT JOIN public.company_memberships membership
    ON membership.company_id = $1::uuid
   AND membership.user_id = private.app_auth_uid()
   AND membership.status = 'active'
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
`;

const INVENTORY_STATUS_SQL = `
    AND (
      ($4::text[] IS NULL AND part.archived_at IS NULL)
      OR (
        $4::text[] IS NOT NULL
        AND (
          ('active' = ANY($4::text[]) AND part.archived_at IS NULL AND part.active)
          OR ('inactive' = ANY($4::text[]) AND part.archived_at IS NULL AND NOT part.active)
          OR ('archived' = ANY($4::text[]) AND part.archived_at IS NOT NULL)
        )
      )
    )
`;

const INVENTORY_SEARCH_SQL = `
    AND (
      $2::text IS NULL
      OR part.normalized_name LIKE '%' || $3::text || '%' ESCAPE '\\'
      OR part.part_no::text LIKE $3::text || '%' ESCAPE '\\'
    )
`;

const INVENTORY_CURSOR_SQL = `
    AND (
      $5::timestamptz IS NULL
      OR (part.created_at, part.id) < ($5::timestamptz, $6::uuid)
    )
  ORDER BY part.created_at DESC, part.id DESC
  LIMIT $7::integer
`;

export const READ_COMPANY_INVENTORY_PAGE_SQL = `
  WITH requester AS (
    SELECT
      membership.role::text AS role,
      private.app_is_dev() AS is_dev
    FROM (SELECT 1) AS seed
    LEFT JOIN public.company_memberships membership
      ON membership.company_id = $1::uuid
     AND membership.user_id = private.app_auth_uid()
     AND membership.status = 'active'
  )
  SELECT
    part.id AS part_id,
    part.part_no,
    CASE
      WHEN part.archived_at IS NOT NULL THEN 'archived'
      WHEN part.active THEN 'active'
      ELSE 'inactive'
    END AS status,
    part.name,
    part.active,
    COALESCE(balance.quantity_on_hand, 0) AS quantity_on_hand,
    part.low_threshold,
    part.unit,
    part.entity_version,
    COALESCE(balance.entity_version, 1) AS stock_entity_version,
    part.created_at,
    pg_catalog.to_char(
      part.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    GREATEST(part.updated_at, COALESCE(balance.updated_at, part.updated_at)) AS updated_at,
    part.archived_at
  FROM public.inventory_parts part
  CROSS JOIN requester
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
  LEFT JOIN public.inventory_locations location
    ON location.company_id = part.company_id
   AND location.location_type = 'company'
   AND location.membership_id IS NULL
  LEFT JOIN public.inventory_balances balance
    ON balance.location_id = location.id
   AND balance.part_id = part.id
  WHERE part.company_id = $1::uuid
    AND entitlement.inventory_enabled
    AND (
      requester.is_dev
      OR requester.role IN ('manager', 'user', 'dev')
    )
${INVENTORY_SEARCH_SQL}${INVENTORY_STATUS_SQL}${INVENTORY_CURSOR_SQL}`;

export const READ_MEMBER_INVENTORY_PAGE_SQL = `
  WITH requester AS (
    SELECT
      membership.id AS membership_id,
      membership.role::text AS role,
      private.app_is_dev() AS is_dev
    FROM (SELECT 1) AS seed
    LEFT JOIN public.company_memberships membership
      ON membership.company_id = $1::uuid
     AND membership.user_id = private.app_auth_uid()
     AND membership.status = 'active'
  )
  SELECT
    part.id AS part_id,
    part.part_no,
    CASE
      WHEN part.archived_at IS NOT NULL THEN 'archived'
      WHEN part.active THEN 'active'
      ELSE 'inactive'
    END AS status,
    part.name,
    part.active,
    balance.quantity_on_hand,
    part.low_threshold,
    part.unit,
    part.entity_version,
    balance.entity_version AS stock_entity_version,
    part.created_at,
    pg_catalog.to_char(
      part.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    GREATEST(part.updated_at, balance.updated_at) AS updated_at,
    part.archived_at
  FROM requester
  INNER JOIN public.inventory_locations location
    ON location.company_id = $1::uuid
   AND location.location_type = 'member'
   AND location.membership_id = requester.membership_id
  INNER JOIN public.inventory_balances balance
    ON balance.location_id = location.id
  INNER JOIN public.inventory_parts part
    ON part.id = balance.part_id
   AND part.company_id = location.company_id
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
  WHERE entitlement.inventory_enabled
    AND (
      requester.is_dev
      OR requester.role IN ('manager', 'worker', 'user', 'dev')
    )
${INVENTORY_SEARCH_SQL}${INVENTORY_STATUS_SQL}${INVENTORY_CURSOR_SQL}`;

export const READ_MANAGED_MEMBER_INVENTORY_ACCESS_SQL = `
  SELECT
    requester.role::text AS role,
    private.app_is_dev() AS is_dev,
    COALESCE(entitlement.inventory_enabled, false) AS inventory_enabled,
    target.id AS target_membership_id
  FROM (SELECT 1) AS seed
  LEFT JOIN public.company_memberships requester
    ON requester.company_id = $1::uuid
   AND requester.user_id = private.app_auth_uid()
   AND requester.status = 'active'
  LEFT JOIN public.company_memberships target
    ON target.company_id = $1::uuid
   AND target.member_no = $2::integer
   AND target.status = 'active'
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
`;

export const READ_MANAGED_MEMBER_INVENTORY_PAGE_SQL = `
  SELECT
    part.id AS part_id,
    part.part_no,
    CASE
      WHEN part.archived_at IS NOT NULL THEN 'archived'
      WHEN part.active THEN 'active'
      ELSE 'inactive'
    END AS status,
    part.name,
    part.active,
    balance.quantity_on_hand,
    part.low_threshold,
    part.unit,
    part.entity_version,
    balance.entity_version AS stock_entity_version,
    part.created_at,
    pg_catalog.to_char(
      part.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    GREATEST(part.updated_at, balance.updated_at) AS updated_at,
    part.archived_at
  FROM public.company_memberships target
  INNER JOIN public.inventory_locations location
    ON location.company_id = target.company_id
   AND location.location_type = 'member'
   AND location.membership_id = target.id
  INNER JOIN public.inventory_balances balance
    ON balance.location_id = location.id
  INNER JOIN public.inventory_parts part
    ON part.id = balance.part_id
   AND part.company_id = location.company_id
  WHERE target.company_id = $1::uuid
    AND target.member_no = $8::integer
    AND target.status = 'active'
${INVENTORY_SEARCH_SQL}${INVENTORY_STATUS_SQL}${INVENTORY_CURSOR_SQL}`;

async function assertInventoryReadAccess(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  scope: InventoryReadScope,
): Promise<void> {
  const result = await transaction.query(READ_INVENTORY_ACCESS_SQL, [internalCompanyId]);
  const row = inventoryAccessRowSchema.parse(result.rows[0]);

  if (!row.inventory_enabled) {
    throw new AppError({
      statusCode: 403,
      code: "INVENTORY_MODULE_DISABLED",
      message: "Inventory is not enabled for this workspace.",
    });
  }

  const allowedRoles = scope === "company"
    ? new Set(["manager", "user", "dev"])
    : new Set(["manager", "worker", "user", "dev"]);
  if (!row.is_dev && (row.role === null || !allowedRoles.has(row.role))) {
    throw new AppError({
      statusCode: 403,
      code: scope === "company"
        ? "COMPANY_INVENTORY_FORBIDDEN"
        : "MEMBER_INVENTORY_FORBIDDEN",
      message: scope === "company"
        ? "Company inventory is not available for this role."
        : "Member inventory is not available for this role.",
    });
  }
}

async function readInventoryPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  scope: InventoryReadScope,
  query: InventoryListQuery,
) {
  await assertInventoryReadAccess(transaction, internalCompanyId, scope);

  const pageSize = query.pageSize ?? DEFAULT_INVENTORY_PAGE_SIZE;
  const cursor = query.afterCursor === undefined
    ? null
    : decodeInventoryListCursor(query.afterCursor);
  const search = escapeLikePattern(query.search);
  const result = await transaction.query<InventoryPartRow>(
    scope === "company" ? READ_COMPANY_INVENTORY_PAGE_SQL : READ_MEMBER_INVENTORY_PAGE_SQL,
    [
      internalCompanyId,
      search,
      search,
      normalizedStatuses(query.status),
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      pageSize + 1,
    ],
  );
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapInventoryPartRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeInventoryListCursor(lastRow.cursor_created_at, lastRow.part_id)
    : null;

  return InventoryListPageSchema.parse({ items, nextCursor });
}

export function readCompanyInventoryPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: InventoryListQuery,
) {
  return readInventoryPage(transaction, internalCompanyId, "company", query);
}

export function readViewerInventoryPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: InventoryListQuery,
) {
  return readInventoryPage(transaction, internalCompanyId, "member", query);
}

export async function readManagedMemberInventoryPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  targetMemberNo: number,
  query: InventoryListQuery,
) {
  const accessResult = await transaction.query(READ_MANAGED_MEMBER_INVENTORY_ACCESS_SQL, [
    internalCompanyId,
    targetMemberNo,
  ]);
  const access = managedMemberInventoryAccessRowSchema.parse(accessResult.rows[0]);
  if (!access.inventory_enabled) {
    throw new AppError({
      statusCode: 403,
      code: "INVENTORY_MODULE_DISABLED",
      message: "Inventory is not enabled for this workspace.",
    });
  }
  if (!access.is_dev && !new Set(["manager", "dev"]).has(access.role ?? "")) {
    throw new AppError({
      statusCode: 403,
      code: "MEMBER_INVENTORY_FORBIDDEN",
      message: "Only managers can read another member's inventory.",
    });
  }
  if (access.target_membership_id === null) {
    throw new AppError({
      statusCode: 404,
      code: "MEMBER_NOT_FOUND",
      message: "The requested member was not found.",
    });
  }

  const pageSize = query.pageSize ?? DEFAULT_INVENTORY_PAGE_SIZE;
  const cursor = query.afterCursor === undefined
    ? null
    : decodeInventoryListCursor(query.afterCursor);
  const search = escapeLikePattern(query.search);
  const result = await transaction.query<InventoryPartRow>(
    READ_MANAGED_MEMBER_INVENTORY_PAGE_SQL,
    [
      internalCompanyId,
      search,
      search,
      normalizedStatuses(query.status),
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      pageSize + 1,
      targetMemberNo,
    ],
  );
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapInventoryPartRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeInventoryListCursor(lastRow.cursor_created_at, lastRow.part_id)
    : null;
  return InventoryListPageSchema.parse({ items, nextCursor });
}
