import {
  JobCreateResultSchema,
  type JobCreateRequest,
  type JobCreateResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const creationRowSchema = z.object({
  job_id: z.uuid(),
  job_no: z.number().int().positive(),
  status: z.enum(["pending", "finished"]),
  entity_version: z.union([z.string(), z.number().int().positive()]),
  finished_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface CreationRow extends QueryResultRow {
  readonly job_id: string;
  readonly job_no: number;
  readonly status: "pending" | "finished";
  readonly entity_version: string | number;
  readonly finished_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function createJobWithDetails(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: JobCreateRequest;
    readonly createdAt: Date;
  },
): Promise<JobCreateResult> {
  const request = input.request;
  const details = {
    ...(request.timeFrom === undefined ? {} : { timeFrom: request.timeFrom }),
    ...(request.timeTo === undefined ? {} : { timeTo: request.timeTo }),
    ...(request.signingPerson === undefined
      ? {}
      : { signingPerson: request.signingPerson }),
    ...(request.travelDistance === undefined
      ? {}
      : { travelDistance: request.travelDistance }),
  };
  const result = await transaction.query<CreationRow>(
    `SELECT *
     FROM private.create_api_job_with_details(
       $1::uuid,
       $2::public.job_status,
       $3::text,
       $4::text,
       $5::text,
       $6::text,
       $7::integer,
       $8::jsonb,
       $9::jsonb,
       $10::uuid,
       $11::timestamptz
     )`,
    [
      input.internalCompanyId,
      request.status,
      request.title,
      request.description,
      request.location ?? null,
      request.clientId ?? null,
      request.assigneeMemberNo ?? null,
      JSON.stringify(details),
      request.partsUsed === undefined ? null : JSON.stringify(request.partsUsed),
      request.uploadSessionId ?? null,
      input.createdAt,
    ],
  );
  const row = creationRowSchema.parse(result.rows[0]);
  return JobCreateResultSchema.parse({
    jobId: row.job_id,
    jobNo: row.job_no,
    status: row.status,
    entityVersion: encodeEntityVersion(row.entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}
