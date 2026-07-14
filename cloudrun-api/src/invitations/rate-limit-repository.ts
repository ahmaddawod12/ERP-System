import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const databaseTimestampSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }),
]);

const invitationRateLimitRowSchema = z.object({
  allowed: z.boolean(),
  reset_at: databaseTimestampSchema,
}).strict();

interface InvitationRateLimitRow extends QueryResultRow {
  readonly allowed: boolean;
  readonly reset_at: Date | string;
}

export type InvitationRateLimitOperation = "create" | "redeem";

export interface InvitationRateLimitResult {
  readonly allowed: boolean;
  readonly resetAt: Date;
}

export const CONSUME_INVITATION_RATE_LIMIT_SQL = `
  SELECT allowed, reset_at
  FROM private.consume_api_invitation_rate_limit($1::text)
`;

export async function consumeInvitationRateLimit(
  transaction: DatabaseQueryable,
  operation: InvitationRateLimitOperation,
): Promise<InvitationRateLimitResult> {
  const result = await transaction.query<InvitationRateLimitRow>(
    CONSUME_INVITATION_RATE_LIMIT_SQL,
    [operation],
  );
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) {
    throw new Error("Invitation rate limit returned no row");
  }
  const row = invitationRateLimitRowSchema.parse(unknownRow);
  const resetAt = row.reset_at instanceof Date
    ? row.reset_at
    : new Date(row.reset_at);
  return {
    allowed: row.allowed,
    resetAt,
  };
}
