import {
  ClientListPageSchema,
  ClientSummarySchema,
  CursorSchema,
  DEFAULT_CLIENT_PAGE_SIZE,
  type ClientListQuery,
  type ClientSummary,
  type Cursor,
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

const clientRowSchema = z.object({
  client_id: z.uuid(),
  client_no: z.number().int().positive(),
  status: z.enum(["active", "archived"]),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  vat_number: z.string().nullable(),
  notes: z.string().nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  cursor_created_at: z.iso.datetime({ offset: true }),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  archived_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

interface ClientRow extends QueryResultRow {
  readonly client_id: string;
  readonly client_no: number;
  readonly status: "active" | "archived";
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly vat_number: string | null;
  readonly notes: string | null;
  readonly entity_version: string | number | bigint;
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

function mapClientRow(unknownRow: unknown): ClientSummary {
  const row = clientRowSchema.parse(unknownRow);
  return ClientSummarySchema.parse({
    clientId: row.client_id,
    clientNo: row.client_no,
    status: row.status,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    vatNumber: row.vat_number,
    notes: row.notes,
    entityVersion: encodeEntityVersion(row.entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    archivedAt: nullableIso(row.archived_at),
  });
}

export function encodeClientListCursor(createdAt: string, id: string): Cursor {
  const payload = cursorPayloadSchema.parse({
    version: 1,
    createdAt,
    id,
  });
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

export function decodeClientListCursor(value: string): { createdAt: string; id: string } {
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

function normalizeLegacyPrefixSearch(value: string | undefined): string | null {
  const normalized = value
    ?.replace(/[%,*().]/g, "")
    .replace(/[\\_]/g, "\\$&")
    .slice(0, 80) ?? "";
  return normalized.length > 0 ? normalized : null;
}

export const READ_CLIENTS_ENTITLEMENT_SQL = `
  SELECT COALESCE(entitlement.clients_enabled, false) AS clients_enabled
  FROM private.get_company_module_entitlements($1::uuid) AS entitlement
`;

export const READ_CLIENTS_PAGE_SQL = `
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
    client.id AS client_id,
    client.client_no,
    client.status::text AS status,
    client.name,
    client.phone,
    client.email,
    client.address,
    client.city,
    client.vat_number,
    client.notes,
    client.entity_version,
    client.created_at,
    pg_catalog.to_char(
      client.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at,
    client.updated_at,
    client.archived_at
  FROM public.clients client
  CROSS JOIN requester
  CROSS JOIN private.get_company_module_entitlements($1::uuid) AS entitlement
  WHERE client.company_id = $1::uuid
    AND entitlement.clients_enabled
    AND (
      requester.is_dev
      OR requester.role IN ('manager', 'worker', 'user', 'basic', 'dev')
    )
    AND (
      $2::text IS NULL
      OR pg_catalog.lower(client.name) LIKE pg_catalog.lower($2::text) || '%' ESCAPE '\\'
      OR COALESCE(client.phone, '') LIKE $2::text || '%' ESCAPE '\\'
      OR pg_catalog.lower(COALESCE(client.email, '')) LIKE pg_catalog.lower($2::text) || '%' ESCAPE '\\'
      OR pg_catalog.lower(COALESCE(client.city, '')) LIKE pg_catalog.lower($2::text) || '%' ESCAPE '\\'
      OR COALESCE(client.vat_number, '') LIKE $2::text || '%' ESCAPE '\\'
    )
    AND ($3::text = 'all' OR client.status::text = $3::text)
    AND (
      $4::timestamptz IS NULL
      OR (client.created_at, client.id) < ($4::timestamptz, $5::uuid)
    )
  ORDER BY client.created_at DESC, client.id DESC
  LIMIT $6::integer
`;

export async function readClientsPage(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  query: ClientListQuery,
) {
  const entitlementResult = await transaction.query<{ clients_enabled: boolean }>(
    READ_CLIENTS_ENTITLEMENT_SQL,
    [internalCompanyId],
  );
  if (entitlementResult.rows[0]?.clients_enabled !== true) {
    throw new AppError({
      statusCode: 403,
      code: "CLIENTS_MODULE_DISABLED",
      message: "Clients are not enabled for this workspace.",
    });
  }

  const pageSize = query.pageSize ?? DEFAULT_CLIENT_PAGE_SIZE;
  const cursor = query.afterCursor === undefined
    ? null
    : decodeClientListCursor(query.afterCursor);
  const result = await transaction.query<ClientRow>(READ_CLIENTS_PAGE_SQL, [
    internalCompanyId,
    normalizeLegacyPrefixSearch(query.search),
    query.status ?? "active",
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  const rows = result.rows.slice(0, pageSize);
  const items = rows.map(mapClientRow);
  const lastRow = rows.at(-1);
  const nextCursor = result.rows.length > pageSize && lastRow !== undefined
    ? encodeClientListCursor(lastRow.cursor_created_at, lastRow.client_id)
    : null;

  return ClientListPageSchema.parse({ items, nextCursor });
}
