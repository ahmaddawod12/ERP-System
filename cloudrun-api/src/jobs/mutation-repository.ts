import {
  JobAcceptResultSchema,
  JobDeleteResultSchema,
  JobUpdateResultSchema,
  type JobAcceptResult,
  type JobDeleteResult,
  type JobUpdateRequest,
  type JobUpdateResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { mapJobRow } from "./read-repository.js";

export const UPDATE_JOB_SQL = `
  SELECT *
  FROM private.update_api_job(
    $1::uuid,
    $2::uuid,
    $3::bigint,
    $4::jsonb,
    $5::timestamptz
  )
`;

export const ACCEPT_JOB_SQL = `
  SELECT *
  FROM private.accept_api_job(
    $1::uuid,
    $2::uuid,
    $3::bigint,
    $4::timestamptz
  )
`;

export const DELETE_JOB_SQL = `
  SELECT *
  FROM private.delete_api_job($1::uuid, $2::uuid, $3::bigint)
`;

const deletionRowSchema = z.object({
  job_id: z.uuid(),
  job_no: z.number().int().positive(),
  deleted: z.literal(true),
}).strict();

interface DeletionRow extends QueryResultRow {
  readonly job_id: string;
  readonly job_no: number;
  readonly deleted: true;
}

export async function updateJob(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly jobId: string;
    readonly expectedEntityVersion: bigint;
    readonly request: JobUpdateRequest;
    readonly updatedAt: Date;
  },
): Promise<JobUpdateResult> {
  const { entityVersion: _entityVersion, ...patch } = input.request;
  const result = await transaction.query<QueryResultRow>(UPDATE_JOB_SQL, [
    input.internalCompanyId,
    input.jobId,
    input.expectedEntityVersion.toString(),
    JSON.stringify(patch),
    input.updatedAt,
  ]);
  return JobUpdateResultSchema.parse(mapJobRow(result.rows[0]));
}

export async function acceptJob(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly jobId: string;
    readonly expectedEntityVersion: bigint;
    readonly acceptedAt: Date;
  },
): Promise<JobAcceptResult> {
  const result = await transaction.query<QueryResultRow>(ACCEPT_JOB_SQL, [
    input.internalCompanyId,
    input.jobId,
    input.expectedEntityVersion.toString(),
    input.acceptedAt,
  ]);
  return JobAcceptResultSchema.parse(mapJobRow(result.rows[0]));
}

export async function deleteJob(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly jobId: string;
    readonly expectedEntityVersion: bigint;
  },
): Promise<JobDeleteResult> {
  const result = await transaction.query<DeletionRow>(DELETE_JOB_SQL, [
    input.internalCompanyId,
    input.jobId,
    input.expectedEntityVersion.toString(),
  ]);
  const row = deletionRowSchema.parse(result.rows[0]);
  return JobDeleteResultSchema.parse({
    jobId: row.job_id,
    jobNo: row.job_no,
    deleted: row.deleted,
  });
}
