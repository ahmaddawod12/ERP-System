import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const rateLimitRowSchema = z.object({
  allowed: z.boolean(),
  reset_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface RateLimitRow extends QueryResultRow {
  readonly allowed: boolean;
  readonly reset_at: Date | string;
}

export interface RequestRateLimitResult {
  readonly allowed: boolean;
  readonly resetAt: Date;
}

function mapRateLimitRow(unknownRow: unknown): RequestRateLimitResult {
  const row = rateLimitRowSchema.parse(unknownRow);
  return {
    allowed: row.allowed,
    resetAt: row.reset_at instanceof Date ? row.reset_at : new Date(row.reset_at),
  };
}

export async function consumeUpgradeRequestRateLimit(
  transaction: DatabaseQueryable,
): Promise<RequestRateLimitResult> {
  const result = await transaction.query<RateLimitRow>(
    `SELECT allowed, reset_at FROM private.consume_api_upgrade_request_rate_limit()`,
  );
  return mapRateLimitRow(result.rows[0]);
}

export async function consumeContactRequestRateLimit(
  transaction: DatabaseQueryable,
  normalizedEmail: string,
): Promise<RequestRateLimitResult> {
  const result = await transaction.query<RateLimitRow>(
    `SELECT allowed, reset_at FROM private.consume_api_contact_request_rate_limit($1::text)`,
    [normalizedEmail],
  );
  return mapRateLimitRow(result.rows[0]);
}
