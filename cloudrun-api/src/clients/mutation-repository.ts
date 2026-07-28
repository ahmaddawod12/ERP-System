import {
  ClientDeleteResultSchema,
  ClientSummarySchema,
  type ClientCreateRequest,
  type ClientDeleteResult,
  type ClientSummary,
  type ClientUpdateRequest,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const clientMutationRowSchema = z.object({
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
  created_at: dateValueSchema,
  updated_at: dateValueSchema,
  archived_at: dateValueSchema.nullable(),
}).strict();

interface ClientMutationRow extends QueryResultRow {
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
  readonly entity_version: bigint | number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
}

const removalRowSchema = z.object({
  client_id: z.uuid(),
  client_no: z.number().int().positive(),
  disposition: z.enum(["deleted", "archived"]),
  entity_version: z.union([
    z.string(),
    z.number().int().positive(),
    z.bigint().positive(),
  ]).nullable(),
  archived_at: dateValueSchema.nullable(),
}).strict();

interface RemovalRow extends QueryResultRow {
  readonly client_id: string;
  readonly client_no: number;
  readonly disposition: "deleted" | "archived";
  readonly entity_version: bigint | number | string | null;
  readonly archived_at: Date | string | null;
}

export const CREATE_CLIENT_SQL = `
  SELECT *
  FROM private.create_api_client($1::uuid, $2::jsonb, $3::timestamptz)
`;

export const UPDATE_CLIENT_SQL = `
  SELECT *
  FROM private.update_api_client(
    $1::uuid,
    $2::uuid,
    $3::bigint,
    $4::jsonb,
    $5::timestamptz
  )
`;

export const DELETE_OR_ARCHIVE_CLIENT_SQL = `
  SELECT *
  FROM private.delete_or_archive_api_client(
    $1::uuid,
    $2::uuid,
    $3::bigint,
    $4::timestamptz
  )
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapClientMutationRow(unknownRow: unknown): ClientSummary {
  const row = clientMutationRowSchema.parse(unknownRow);
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

export async function createClient(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: ClientCreateRequest;
    readonly createdAt: Date;
  },
): Promise<ClientSummary> {
  const result = await transaction.query<ClientMutationRow>(CREATE_CLIENT_SQL, [
    input.internalCompanyId,
    JSON.stringify(input.request),
    input.createdAt,
  ]);
  return mapClientMutationRow(result.rows[0]);
}

export async function updateClient(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly clientId: string;
    readonly expectedEntityVersion: bigint;
    readonly request: ClientUpdateRequest;
    readonly updatedAt: Date;
  },
): Promise<ClientSummary> {
  const { entityVersion: _entityVersion, ...patch } = input.request;
  const result = await transaction.query<ClientMutationRow>(UPDATE_CLIENT_SQL, [
    input.internalCompanyId,
    input.clientId,
    input.expectedEntityVersion.toString(),
    JSON.stringify(patch),
    input.updatedAt,
  ]);
  return mapClientMutationRow(result.rows[0]);
}

export async function deleteOrArchiveClient(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly clientId: string;
    readonly expectedEntityVersion: bigint;
    readonly removedAt: Date;
  },
): Promise<ClientDeleteResult> {
  const result = await transaction.query<RemovalRow>(DELETE_OR_ARCHIVE_CLIENT_SQL, [
    input.internalCompanyId,
    input.clientId,
    input.expectedEntityVersion.toString(),
    input.removedAt,
  ]);
  const row = removalRowSchema.parse(result.rows[0]);
  return ClientDeleteResultSchema.parse({
    clientId: row.client_id,
    clientNo: row.client_no,
    disposition: row.disposition,
    entityVersion: row.entity_version === null ? null : encodeEntityVersion(row.entity_version),
    archivedAt: nullableIso(row.archived_at),
  });
}
