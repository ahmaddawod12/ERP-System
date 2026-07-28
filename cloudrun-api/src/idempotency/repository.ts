import { createHash, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";

interface IdempotencyRow extends QueryResultRow {
  readonly id: string;
  readonly request_hash: Buffer;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly completed_at: Date | null;
  readonly expires_at: Date;
}

export interface IdempotencyClaim {
  readonly id: string;
  readonly replayed: boolean;
  readonly responseStatus?: number;
  readonly responseBody?: unknown;
}

export interface IdempotencyReplay {
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Idempotency payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Idempotency payload contains an unsupported value");
}

export function hashIdempotencyValue(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hashIdempotencyRequest(value: unknown): Buffer {
  return hashIdempotencyValue(canonicalJson(value));
}

export async function readCompletedIdempotencyKey(
  transaction: DatabaseQueryable,
  input: {
    readonly userId: string;
    readonly internalCompanyId: string | null;
    readonly operation: string;
    readonly key: string;
    readonly request: unknown;
  },
): Promise<IdempotencyReplay | null> {
  const keyHash = hashIdempotencyValue(input.key);
  const requestHash = hashIdempotencyRequest(input.request);
  const result = await transaction.query<IdempotencyRow>(
    `SELECT id, request_hash, response_status, response_body, completed_at, expires_at
     FROM private.api_idempotency
     WHERE user_id = $1
       AND company_id IS NOT DISTINCT FROM $2::uuid
       AND operation = $3
       AND idempotency_key_hash = $4
       AND expires_at > clock_timestamp()
     LIMIT 1`,
    [input.userId, input.internalCompanyId, input.operation, keyHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!hashesMatch(row.request_hash, requestHash)) {
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "The idempotency key was already used for a different request.",
    });
  }
  if (
    row.completed_at === null
    || row.response_status === null
    || row.response_body === null
  ) {
    return null;
  }
  return {
    responseStatus: row.response_status,
    responseBody: row.response_body,
  };
}

function hashesMatch(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function claimIdempotencyKey(
  transaction: DatabaseQueryable,
  input: {
    readonly userId: string;
    readonly internalCompanyId: string | null;
    readonly operation: string;
    readonly key: string;
    readonly request: unknown;
  },
): Promise<IdempotencyClaim> {
  const keyHash = hashIdempotencyValue(input.key);
  const requestHash = hashIdempotencyRequest(input.request);

  await transaction.query(
    `INSERT INTO private.api_idempotency (
       user_id, company_id, operation, idempotency_key_hash, request_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '24 hours')
     ON CONFLICT DO NOTHING`,
    [input.userId, input.internalCompanyId, input.operation, keyHash, requestHash],
  );

  const result = await transaction.query<IdempotencyRow>(
    `SELECT
       id, request_hash, response_status, response_body, completed_at, expires_at
     FROM private.api_idempotency
     WHERE user_id = $1
       AND company_id IS NOT DISTINCT FROM $2::uuid
       AND operation = $3
       AND idempotency_key_hash = $4
     FOR UPDATE`,
    [input.userId, input.internalCompanyId, input.operation, keyHash],
  );
  let row = result.rows[0];
  if (row === undefined) {
    throw new Error("Idempotency claim was not persisted");
  }

  if (row.expires_at.getTime() <= Date.now()) {
    const reset = await transaction.query<IdempotencyRow>(
      `UPDATE private.api_idempotency
       SET request_hash = $2,
           response_status = NULL,
           response_body = NULL,
           completed_at = NULL,
           expires_at = clock_timestamp() + interval '24 hours',
           updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING
         id, request_hash, response_status, response_body, completed_at, expires_at`,
      [row.id, requestHash],
    );
    const resetRow = reset.rows[0];
    if (resetRow === undefined) throw new Error("Expired idempotency claim was not reset");
    row = resetRow;
  }

  if (!hashesMatch(row.request_hash, requestHash)) {
    throw new AppError({
      statusCode: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "The idempotency key was already used for a different request.",
    });
  }

  if (row.completed_at !== null) {
    if (row.response_status === null || row.response_body === null) {
      throw new Error("Completed idempotency row is missing its response");
    }
    return {
      id: row.id,
      replayed: true,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  return { id: row.id, replayed: false };
}

export async function completeIdempotencyClaim(
  transaction: DatabaseQueryable,
  id: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  const result = await transaction.query(
    `UPDATE private.api_idempotency
     SET response_status = $2,
         response_body = $3,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
     WHERE id = $1
       AND completed_at IS NULL`,
    [id, responseStatus, JSON.stringify(responseBody)],
  );
  if (result.rowCount !== 1) {
    throw new Error("Idempotency claim could not be completed");
  }
}
