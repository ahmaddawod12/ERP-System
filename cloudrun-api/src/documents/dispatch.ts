import { randomInt, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";

const claimedDispatchRowSchema = z.object({
  task_key: z.string().trim().min(1).max(160),
  task_type: z.enum(["preview", "generate"]),
  user_id: z.uuid(),
  dispatch_attempt: z.number().int().positive(),
  dispatch_payload: z.record(z.string(), z.unknown()),
}).strict();

interface ClaimedDispatchRow extends QueryResultRow {
  readonly task_key: string;
  readonly task_type: "preview" | "generate";
  readonly user_id: string;
  readonly dispatch_attempt: number;
  readonly dispatch_payload: Record<string, unknown>;
}

export interface ClaimedDocumentDispatch {
  readonly taskKey: string;
  readonly taskType: "preview" | "generate";
  readonly userId: string;
  readonly attempt: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DocumentTaskPublisher {
  publish(
    taskType: ClaimedDocumentDispatch["taskType"],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export interface DocumentDispatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly deferred: number;
}

export const CLAIM_DOCUMENT_DISPATCH_SQL = `
  SELECT *
  FROM private.claim_api_document_dispatch_batch(
    $1::uuid,
    $2::integer,
    $3::integer,
    $4::text
  )
`;

export const COMPLETE_DOCUMENT_DISPATCH_SQL = `
  SELECT private.complete_api_document_dispatch(
    $1::text,
    $2::uuid,
    $3::timestamptz
  ) AS completed
`;

export const RETRY_DOCUMENT_DISPATCH_SQL = `
  SELECT private.retry_api_document_dispatch(
    $1::text,
    $2::uuid,
    $3::text,
    $4::integer
  ) AS deferred
`;

async function claimDispatches(
  transaction: DatabaseQueryable,
  input: {
    readonly leaseToken: string;
    readonly limit: number;
    readonly taskKey?: string;
  },
): Promise<ClaimedDocumentDispatch[]> {
  const result = await transaction.query<ClaimedDispatchRow>(CLAIM_DOCUMENT_DISPATCH_SQL, [
    input.leaseToken,
    input.limit,
    30,
    input.taskKey ?? null,
  ]);
  return result.rows.map((unknownRow) => {
    const row = claimedDispatchRowSchema.parse(unknownRow);
    return {
      taskKey: row.task_key,
      taskType: row.task_type,
      userId: row.user_id,
      attempt: row.dispatch_attempt,
      payload: row.dispatch_payload,
    };
  });
}

function retryDelaySeconds(attempt: number): number {
  const cap = Math.min(3_600, 2 ** Math.min(attempt, 11));
  return randomInt(1, cap + 1);
}

function safeDispatchError(error: unknown): string {
  if (error instanceof Error) {
    return error.name.length > 0 ? `${error.name}: ${error.message}`.slice(0, 2_000) : error.message.slice(0, 2_000);
  }
  return "Document dispatch failed";
}

async function completeDispatch(
  database: ApiDatabaseRuntime,
  dispatch: ClaimedDocumentDispatch,
  leaseToken: string,
): Promise<void> {
  await database.withTransaction({ userId: dispatch.userId }, async (transaction) => {
    const result = await transaction.query<{ completed: boolean }>(COMPLETE_DOCUMENT_DISPATCH_SQL, [
      dispatch.taskKey,
      leaseToken,
      new Date(),
    ]);
    if (result.rows[0]?.completed !== true) {
      throw new Error("Document dispatch lease was lost before completion");
    }
  });
}

async function deferDispatch(
  database: ApiDatabaseRuntime,
  dispatch: ClaimedDocumentDispatch,
  leaseToken: string,
  error: unknown,
): Promise<void> {
  await database.withTransaction({ userId: dispatch.userId }, async (transaction) => {
    const result = await transaction.query<{ deferred: boolean }>(RETRY_DOCUMENT_DISPATCH_SQL, [
      dispatch.taskKey,
      leaseToken,
      safeDispatchError(error),
      retryDelaySeconds(dispatch.attempt),
    ]);
    if (result.rows[0]?.deferred !== true) {
      throw new Error("Document dispatch lease was lost before retry scheduling");
    }
  });
}

export async function dispatchPendingDocumentTasks(
  database: ApiDatabaseRuntime,
  publisher: DocumentTaskPublisher,
  input: {
    readonly userId: string;
    readonly taskKey?: string;
    readonly limit?: number;
  },
): Promise<DocumentDispatchResult> {
  const leaseToken = randomUUID();
  const limit = Math.min(100, Math.max(1, input.limit ?? (input.taskKey ? 1 : 20)));
  const dispatches = await database.withTransaction(
    { userId: input.userId },
    (transaction) => claimDispatches(transaction, {
      leaseToken,
      limit,
      ...(input.taskKey === undefined ? {} : { taskKey: input.taskKey }),
    }),
  );
  let published = 0;
  let deferred = 0;

  for (const dispatch of dispatches) {
    try {
      await publisher.publish(dispatch.taskType, dispatch.payload);
      await completeDispatch(database, dispatch, leaseToken);
      published += 1;
    } catch (error) {
      await deferDispatch(database, dispatch, leaseToken, error);
      deferred += 1;
    }
  }

  return { claimed: dispatches.length, published, deferred };
}
