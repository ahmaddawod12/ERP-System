import {
  DEFAULT_WORKER_PAGE_SIZE,
  WorkerListPageSchema,
  WorkerSummarySchema,
  CursorSchema,
  type Cursor,
  type WorkerDirectoryRole,
  type WorkerListQuery,
  type WorkerMembershipStatus,
  type WorkerSummary,
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

const workerAccessRowSchema = z.object({
  role: z.string().nullable(),
  is_dev: z.boolean(),
  subscription_active: z.boolean(),
  team_enabled: z.boolean(),
}).strict();

const workerRowSchema = z.object({
  membership_id: z.uuid(),
  member_no: z.number().int().positive(),
  role: z.enum(["worker", "user", "basic"]),
  status: z.enum(["active", "disabled", "pending"]),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  phone_number: z.string().nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  joined_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  cursor_created_at: z.iso.datetime({ offset: true }),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface WorkerRow extends QueryResultRow {
  readonly membership_id: string;
  readonly member_no: number;
  readonly role: WorkerDirectoryRole;
  readonly status: WorkerMembershipStatus;
  readonly display_name: string | null;
  readonly email: string | null;
  readonly phone_number: string | null;
  readonly entity_version: bigint | number | string;
  readonly joined_at: Date | string;
  readonly created_at: Date | string;
  readonly cursor_created_at: string;
  readonly updated_at: Date | string;
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

function mapWorkerRow(unknownRow: unknown): WorkerSummary {
  const row = workerRowSchema.parse(unknownRow);
  const displayName = row.display_name?.trim() || null;
  const email = row.email?.trim() || null;
  const phoneNumber = row.phone_number?.trim() || null;
  return WorkerSummarySchema.parse({
    memberNo: row.member_no,
    role: row.role,
    status: row.status,
    displayName,
    email,
    phoneNumber,
    entityVersion: encodeEntityVersion(row.entity_version),
    joinedAt: toIso(row.joined_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

export function encodeWorkerListCursor(createdAt: string, id: string): Cursor {
  const payload = cursorPayloadSchema.parse({
    version: 1,
    createdAt,
    id,
  });
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

export function decodeWorkerListCursor(value: string): { createdAt: string; id: string } {
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

function normalizePrefixSearch(value: string | undefined): string | null {
  const normalized = value
    ?.replace(/[%,*().]/g, "")
    .replace(/[\\_]/g, "\\$&")
    .slice(0, 80) ?? "";
  return normalized.length > 0 ? normalized : null;
}

function arrayFilter<T extends string>(value: T | readonly T[] | undefined): T[] | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? [...value] : [value as T];
}

export const READ_WORKERS_ACCESS_SQL = `
  WITH requester AS (
    SELECT
      membership.role::text AS role,
      private.app_is_dev() AS is_dev
    FROM (SELECT 1) AS seed
    LEFT JOIN public.company_memberships membership
      ON membership.company_id = $1::uuid
     AND membership.user_id = private.app_auth_uid()
     AND membership.status = 'active'
  ),
  subscription AS (
    SELECT
      company_subscription.tier::text AS tier,
      company_subscription.status::text AS status,
      company_subscription.enabled_modules,
      company_subscription.expires_at
    FROM public.company_subscriptions company_subscription
    WHERE company_subscription.company_id = $1::uuid
    LIMIT 1
  )
  SELECT
    requester.role,
    requester.is_dev,
    COALESCE(
      subscription.status IN ('active', 'trial')
      AND (
        subscription.expires_at IS NULL
        OR subscription.expires_at > pg_catalog.statement_timestamp()
      ),
      false
    ) AS subscription_active,
    COALESCE(
      CASE
        WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'team') = 'boolean'
          THEN (subscription.enabled_modules ->> 'team')::boolean
        ELSE subscription.tier IN ('Team', 'Enterprise')
      END,
      false
    ) AS team_enabled
  FROM requester
  LEFT JOIN subscription ON true
`;

export const READ_WORKERS_PAGE_SQL = `
  WITH requester AS (
    SELECT
      membership.role::text AS role,
      private.app_is_dev() AS is_dev
    FROM (SELECT 1) AS seed
    LEFT JOIN public.company_memberships membership
      ON membership.company_id = $1::uuid
     AND membership.user_id = private.app_auth_uid()
     AND membership.status = 'active'
  ),
  subscription AS (
    SELECT
      company_subscription.tier::text AS tier,
      company_subscription.status::text AS status,
      company_subscription.enabled_modules,
      company_subscription.expires_at
    FROM public.company_subscriptions company_subscription
    WHERE company_subscription.company_id = $1::uuid
    LIMIT 1
  ),
  access AS (
    SELECT
      requester.role,
      requester.is_dev,
      COALESCE(
        subscription.status IN ('active', 'trial')
        AND (
          subscription.expires_at IS NULL
          OR subscription.expires_at > pg_catalog.statement_timestamp()
        ),
        false
      ) AS subscription_active,
      COALESCE(
        CASE
          WHEN pg_catalog.jsonb_typeof(subscription.enabled_modules -> 'team') = 'boolean'
            THEN (subscription.enabled_modules ->> 'team')::boolean
          ELSE subscription.tier IN ('Team', 'Enterprise')
        END,
        false
      ) AS team_enabled
    FROM requester
    LEFT JOIN subscription ON true
  )
  SELECT
    membership.id AS membership_id,
    membership.member_no,
    membership.role::text AS role,
    membership.status::text AS status,
    membership.display_name,
    app_user.email,
    membership.phone_number,
    membership.entity_version,
    membership.joined_at,
    membership.created_at,
    pg_catalog.to_char(
      membership.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    membership.updated_at
  FROM public.company_memberships membership
  CROSS JOIN access
  LEFT JOIN public.app_users app_user
    ON app_user.id = membership.user_id
  WHERE membership.company_id = $1::uuid
    AND membership.role IN ('worker', 'user', 'basic')
    AND (
      access.is_dev
      OR (
        access.role = 'manager'
        AND access.subscription_active
        AND access.team_enabled
      )
    )
    AND ($2::public.membership_role[] IS NULL OR membership.role = ANY($2::public.membership_role[]))
    AND ($3::public.membership_status[] IS NULL OR membership.status = ANY($3::public.membership_status[]))
    AND (
      $4::text IS NULL
      OR pg_catalog.lower(COALESCE(membership.display_name, '')) LIKE pg_catalog.lower($4::text) || '%' ESCAPE '\\'
      OR pg_catalog.lower(COALESCE(app_user.email, '')) LIKE pg_catalog.lower($4::text) || '%' ESCAPE '\\'
      OR COALESCE(membership.phone_number, '') LIKE $4::text || '%' ESCAPE '\\'
    )
    AND (
      $5::timestamptz IS NULL
      OR (membership.created_at, membership.id) < ($5::timestamptz, $6::uuid)
    )
  ORDER BY membership.created_at DESC, membership.id DESC
  LIMIT $7::integer
`;

export async function readWorkersPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: WorkerListQuery,
) {
  const accessResult = await transaction.query(READ_WORKERS_ACCESS_SQL, [internalCompanyId]);
  const access = workerAccessRowSchema.parse(accessResult.rows[0]);

  if (!access.is_dev && access.role !== "manager") {
    throw new AppError({
      statusCode: 403,
      code: "WORKERS_ACCESS_FORBIDDEN",
      message: "A workspace manager is required to view the team directory.",
    });
  }
  if (!access.is_dev && (!access.subscription_active || !access.team_enabled)) {
    throw new AppError({
      statusCode: 403,
      code: "WORKERS_MODULE_DISABLED",
      message: "Team management is not enabled for this workspace.",
    });
  }

  const pageSize = query.pageSize ?? DEFAULT_WORKER_PAGE_SIZE;
  const cursor = query.afterCursor === undefined
    ? null
    : decodeWorkerListCursor(query.afterCursor);
  const result = await transaction.query<WorkerRow>(READ_WORKERS_PAGE_SQL, [
    internalCompanyId,
    arrayFilter(query.role),
    arrayFilter(query.status),
    normalizePrefixSearch(query.search),
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapWorkerRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeWorkerListCursor(lastRow.cursor_created_at, lastRow.membership_id)
    : null;

  return WorkerListPageSchema.parse({ items, nextCursor });
}
