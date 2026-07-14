import {
  CursorSchema,
  DEFAULT_JOB_PAGE_SIZE,
  JobListPageSchema,
  JobSummarySchema,
  type Cursor,
  type JobListQuery,
  type JobSummary,
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

const jobRowSchema = z.object({
  job_id: z.uuid(),
  job_no: z.number().int().positive(),
  status: z.enum(["pending", "waiting", "finished", "denied"]),
  title: z.string(),
  description: z.string(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  category: z.string().nullable(),
  priority: z.string().nullable(),
  due_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  client_id: z.uuid().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  assignee_member_no: z.number().int().positive().nullable(),
  assignee_display_name: z.string().nullable(),
  creator_uid: z.uuid().nullable(),
  creator_member_no: z.number().int().positive().nullable(),
  creator_display_name: z.string().nullable(),
  is_certificate: z.boolean(),
  meta: z.unknown(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  cursor_created_at: z.iso.datetime({ offset: true }).optional(),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  finished_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  denied_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

interface JobRow extends QueryResultRow {
  readonly job_id: string;
  readonly job_no: number;
  readonly status: "pending" | "waiting" | "finished" | "denied";
  readonly title: string;
  readonly description: string;
  readonly notes: string | null;
  readonly location: string | null;
  readonly address: string | null;
  readonly category: string | null;
  readonly priority: string | null;
  readonly due_at: Date | string | null;
  readonly client_id: string | null;
  readonly client_name: string | null;
  readonly client_phone: string | null;
  readonly assignee_member_no: number | null;
  readonly assignee_display_name: string | null;
  readonly creator_uid: string | null;
  readonly creator_member_no: number | null;
  readonly creator_display_name: string | null;
  readonly is_certificate: boolean;
  readonly meta: unknown;
  readonly entity_version: string | number | bigint;
  readonly created_at: Date | string;
  readonly cursor_created_at: string;
  readonly updated_at: Date | string;
  readonly finished_at: Date | string | null;
  readonly denied_at: Date | string | null;
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

function normalizeMeta(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableTime(value: unknown): string | null {
  return typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : null;
}

function nullableSigningPerson(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 ? value : null;
}

function nullableTravelDistance(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 10_000_000
    ? numeric
    : null;
}

export function mapJobRow(unknownRow: unknown): JobSummary {
  const row = jobRowSchema.parse(unknownRow);
  const meta = normalizeMeta(row.meta);
  const client = row.client_id !== null || row.client_name !== null || row.client_phone !== null
    ? { id: row.client_id, name: row.client_name, phone: row.client_phone }
    : null;
  const assignee = row.assignee_member_no === null
    ? null
    : {
        memberNo: row.assignee_member_no,
        displayName: row.assignee_display_name,
      };
  const creator = (
    row.creator_uid !== null
    || row.creator_member_no !== null
    || row.creator_display_name !== null
  )
    ? {
        uid: row.creator_uid,
        memberNo: row.creator_member_no,
        displayName: row.creator_display_name,
      }
    : null;

  return JobSummarySchema.parse({
    jobId: row.job_id,
    jobNo: row.job_no,
    status: row.status,
    title: row.title,
    description: row.description,
    notes: row.notes,
    location: row.location,
    address: row.address,
    category: row.category,
    priority: row.priority,
    dueAt: nullableIso(row.due_at),
    client,
    assignee,
    creator,
    isCertificate: row.is_certificate,
    timeFrom: nullableTime(meta.timeFrom),
    timeTo: nullableTime(meta.timeTo),
    signingPerson: nullableSigningPerson(meta.signingPerson),
    travelDistance: nullableTravelDistance(meta.travelDistance),
    entityVersion: encodeEntityVersion(row.entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: nullableIso(row.finished_at),
    deniedAt: nullableIso(row.denied_at),
  });
}

export function encodeJobListCursor(createdAt: string, id: string): Cursor {
  const payload = cursorPayloadSchema.parse({
    version: 1,
    createdAt,
    id,
  });
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

export function decodeJobListCursor(value: string): { createdAt: string; id: string } {
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

export const READ_JOBS_ENTITLEMENT_SQL = `
  SELECT COALESCE(entitlement.jobs_enabled, false) AS jobs_enabled
  FROM private.get_company_module_entitlements($1::uuid) AS entitlement
`;

export const READ_JOBS_PAGE_SQL = `
  WITH requester AS (
    SELECT
      company.id AS company_id,
      company.account_type::text AS account_type,
      membership.id AS membership_id,
      membership.role::text AS role,
      private.app_is_dev() AS is_dev
    FROM public.companies company
    LEFT JOIN public.company_memberships membership
      ON membership.company_id = company.id
     AND membership.user_id = private.app_auth_uid()
     AND membership.status = 'active'
    WHERE company.id = $1::uuid
  )
  SELECT
    job.id AS job_id,
    job.job_no,
    job.status::text AS status,
    COALESCE(job.title, '') AS title,
    COALESCE(job.description, '') AS description,
    job.notes,
    job.location,
    job.address,
    job.category,
    job.priority,
    job.due_at,
    job.client_id,
    job.client_name_snapshot AS client_name,
    job.client_phone_snapshot AS client_phone,
    assignee.member_no AS assignee_member_no,
    COALESCE(
      NULLIF(BTRIM(assignee.display_name), ''),
      NULLIF(BTRIM(assignee_user.display_name), ''),
      job.assigned_member_name_snapshot
    ) AS assignee_display_name,
    creator.user_id::uuid AS creator_uid,
    creator.member_no AS creator_member_no,
    COALESCE(
      NULLIF(BTRIM(creator.display_name), ''),
      NULLIF(BTRIM(creator_user.display_name), ''),
      job.created_by_name_snapshot
    ) AS creator_display_name,
    job.is_cert AS is_certificate,
    job.meta,
    job.entity_version,
    job.created_at,
    pg_catalog.to_char(
      job.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    job.updated_at,
    job.finished_at,
    job.denied_at
  FROM public.jobs job
  CROSS JOIN requester
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
  LEFT JOIN public.company_memberships assignee
    ON assignee.id = job.assigned_membership_id
   AND assignee.company_id = job.company_id
  LEFT JOIN public.app_users assignee_user
    ON assignee_user.id = assignee.user_id
  LEFT JOIN public.company_memberships creator
    ON creator.id = job.created_by_membership_id
   AND creator.company_id = job.company_id
  LEFT JOIN public.app_users creator_user
    ON creator_user.id = creator.user_id
  WHERE job.company_id = $1::uuid
    AND entitlement.jobs_enabled
    AND (
      requester.is_dev
      OR requester.role = 'manager'
      OR (
        requester.role = 'user'
        AND (
          requester.account_type = 'solo'
          OR job.assigned_membership_id = requester.membership_id
        )
      )
      OR (
        requester.role = 'worker'
        AND job.assigned_membership_id = requester.membership_id
      )
    )
    AND ($2::public.job_status[] IS NULL OR job.status = ANY($2::public.job_status[]))
    AND ($3::timestamptz IS NULL OR job.created_at >= $3::timestamptz)
    AND ($4::timestamptz IS NULL OR job.created_at <= $4::timestamptz)
    AND ($5::uuid IS NULL OR creator.user_id = $5::uuid::text)
    AND (
      $6::text IS NULL
      OR job.job_no::text = $6::text
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.title, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.description, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.location, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.address, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.client_name_snapshot, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.client_phone_snapshot, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.assigned_member_name_snapshot, '')), pg_catalog.lower($6::text)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(job.created_by_name_snapshot, '')), pg_catalog.lower($6::text)) > 0
    )
    AND (
      $7::timestamptz IS NULL
      OR (job.created_at, job.id) < ($7::timestamptz, $8::uuid)
    )
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT $9::integer
`;

export async function readJobsPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: JobListQuery,
) {
  const entitlementResult = await transaction.query<{ jobs_enabled: boolean }>(
    READ_JOBS_ENTITLEMENT_SQL,
    [internalCompanyId],
  );
  if (entitlementResult.rows[0]?.jobs_enabled !== true) {
    throw new AppError({
      statusCode: 403,
      code: "JOBS_MODULE_DISABLED",
      message: "Jobs are not enabled for this workspace.",
    });
  }

  const pageSize = query.limit ?? query.pageSize ?? DEFAULT_JOB_PAGE_SIZE;
  const statuses = query.status === undefined
    ? null
    : [...new Set(Array.isArray(query.status) ? query.status : [query.status])];
  const cursor = query.afterCursor === undefined
    ? null
    : decodeJobListCursor(query.afterCursor);
  const result = await transaction.query<JobRow>(READ_JOBS_PAGE_SQL, [
    internalCompanyId,
    statuses,
    query.dateFrom ?? null,
    query.dateTo ?? null,
    query.creatorUid ?? null,
    query.search ?? null,
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapJobRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeJobListCursor(lastRow.cursor_created_at, lastRow.job_id)
    : null;

  return JobListPageSchema.parse({ items, nextCursor });
}
