import {
  JobCompletionResultSchema,
  type JobCompletionResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const completionRowSchema = z.object({
  job_id: z.uuid(),
  job_no: z.number().int().positive(),
  status: z.literal("finished"),
  entity_version: z.union([z.string(), z.number().int().positive()]),
  finished_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface CompletionRow extends QueryResultRow {
  readonly job_id: string;
  readonly job_no: number;
  readonly status: string;
  readonly entity_version: string | number;
  readonly finished_at: Date | string;
  readonly updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function completeJobWithDetails(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly jobId: string;
    readonly expectedEntityVersion: bigint;
    readonly details: Readonly<Record<string, unknown>>;
    readonly parts: readonly Readonly<{ partId: number; quantity: number }>[] | null;
    readonly uploadSessionId: string | null;
    readonly completedAt: Date;
  },
): Promise<JobCompletionResult> {
  const result = await transaction.query<CompletionRow>(
    `SELECT *
     FROM private.complete_job_with_details(
       $1::uuid,
       $2::uuid,
       $3::bigint,
       $4::jsonb,
       $5::jsonb,
       $6::uuid,
       $7::timestamptz
     )`,
    [
      input.internalCompanyId,
      input.jobId,
      input.expectedEntityVersion.toString(),
      JSON.stringify(input.details),
      input.parts === null ? null : JSON.stringify(input.parts),
      input.uploadSessionId,
      input.completedAt,
    ],
  );
  const row = completionRowSchema.parse(result.rows[0]);
  return JobCompletionResultSchema.parse({
    jobId: row.job_id,
    jobNo: row.job_no,
    status: row.status,
    entityVersion: encodeEntityVersion(row.entity_version),
    finishedAt: toIso(row.finished_at),
    updatedAt: toIso(row.updated_at),
  });
}
