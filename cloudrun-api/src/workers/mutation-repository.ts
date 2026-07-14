import {
  WorkerSummarySchema,
  type WorkerSummary,
  type WorkerUpdateRequest,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const workerMutationRowSchema = z.object({
  member_no: z.number().int().positive(),
  role: z.enum(["worker", "user", "basic"]),
  status: z.enum(["active", "disabled", "pending"]),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  phone_number: z.string().nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  joined_at: dateValueSchema,
  created_at: dateValueSchema,
  updated_at: dateValueSchema,
}).strict();

interface WorkerMutationRow extends QueryResultRow {
  readonly member_no: number;
  readonly role: "worker" | "user" | "basic";
  readonly status: "active" | "disabled" | "pending";
  readonly display_name: string | null;
  readonly email: string | null;
  readonly phone_number: string | null;
  readonly entity_version: bigint | number | string;
  readonly joined_at: Date | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export const UPDATE_WORKER_MEMBERSHIP_SQL = `
  SELECT *
  FROM private.update_api_worker_membership(
    $1::uuid,
    $2::integer,
    $3::bigint,
    $4::jsonb,
    $5::timestamptz
  )
`;

export const DISABLE_WORKER_MEMBERSHIP_SQL = `
  SELECT *
  FROM private.disable_api_worker_membership(
    $1::uuid,
    $2::integer,
    $3::bigint,
    $4::timestamptz
  )
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapWorkerMutationRow(unknownRow: unknown): WorkerSummary {
  const row = workerMutationRowSchema.parse(unknownRow);
  return WorkerSummarySchema.parse({
    memberNo: row.member_no,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
    email: row.email,
    phoneNumber: row.phone_number,
    entityVersion: encodeEntityVersion(row.entity_version),
    joinedAt: toIso(row.joined_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

export async function updateWorkerMembership(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly memberNo: number;
    readonly expectedEntityVersion: bigint;
    readonly request: WorkerUpdateRequest;
    readonly updatedAt: Date;
  },
): Promise<WorkerSummary> {
  const { entityVersion: _entityVersion, ...patch } = input.request;
  const result = await transaction.query<WorkerMutationRow>(UPDATE_WORKER_MEMBERSHIP_SQL, [
    input.internalCompanyId,
    input.memberNo,
    input.expectedEntityVersion.toString(),
    JSON.stringify(patch),
    input.updatedAt,
  ]);
  return mapWorkerMutationRow(result.rows[0]);
}

export async function disableWorkerMembership(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly memberNo: number;
    readonly expectedEntityVersion: bigint;
    readonly disabledAt: Date;
  },
): Promise<WorkerSummary> {
  const result = await transaction.query<WorkerMutationRow>(DISABLE_WORKER_MEMBERSHIP_SQL, [
    input.internalCompanyId,
    input.memberNo,
    input.expectedEntityVersion.toString(),
    input.disabledAt,
  ]);
  return mapWorkerMutationRow(result.rows[0]);
}
