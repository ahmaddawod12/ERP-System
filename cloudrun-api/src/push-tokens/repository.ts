import {
  PushTokenPlatformSchema,
  PushTokenUpsertResultSchema,
  type PushTokenPlatform,
  type PushTokenUpsertResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";

const pushTokenRowSchema = z.object({
  push_token_platform: PushTokenPlatformSchema,
  push_token_updated_at: z.union([
    z.date(),
    z.iso.datetime({ offset: true }),
  ]),
}).strict();

interface PushTokenRow extends QueryResultRow {
  readonly push_token_platform: PushTokenPlatform;
  readonly push_token_updated_at: Date | string;
}

const clearPushTokenRowSchema = z.object({
  cleared: z.literal(true),
}).strict();

export const UPSERT_PUSH_TOKEN_SQL = `
  SELECT push_token_platform, push_token_updated_at
  FROM private.register_api_push_device($1::text, $2::text, $3::text)
`;

export const CLEAR_PUSH_TOKEN_SQL = `
  SELECT private.clear_api_push_device($1::text) AS cleared
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function profileNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: "PROFILE_NOT_FOUND",
    message: "The authenticated user profile was not found.",
  });
}

export async function upsertPushToken(
  transaction: DatabaseQueryable,
  input: {
    readonly deviceId: string;
    readonly token: string;
    readonly platform: PushTokenPlatform;
  },
): Promise<PushTokenUpsertResult> {
  const result = await transaction.query<PushTokenRow>(
    UPSERT_PUSH_TOKEN_SQL,
    [input.deviceId, input.token, input.platform],
  );
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) throw profileNotFound();
  const row = pushTokenRowSchema.parse(unknownRow);

  return PushTokenUpsertResultSchema.parse({
    registered: true,
    platform: row.push_token_platform,
    pushTokenUpdatedAt: toIso(row.push_token_updated_at),
  });
}

export async function clearPushToken(
  transaction: DatabaseQueryable,
  deviceId: string,
): Promise<void> {
  const result = await transaction.query(CLEAR_PUSH_TOKEN_SQL, [deviceId]);
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) throw profileNotFound();
  const row = z.object({ cleared: z.boolean() }).strict().parse(unknownRow);
  if (!row.cleared) throw profileNotFound();
  clearPushTokenRowSchema.parse(row);
}
