import { randomInt, randomUUID } from "node:crypto";
import {
  EmailDispatchMessageSchema,
  type EmailDispatchMessage,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";

const claimedEmailDispatchRowSchema = z.object({
  delivery_id: z.uuid(),
  dispatch_attempt: z.number().int().positive(),
}).strict();

interface ClaimedEmailDispatchRow extends QueryResultRow {
  readonly delivery_id: string;
  readonly dispatch_attempt: number;
}

interface ClaimedEmailDispatch {
  readonly deliveryId: string;
  readonly attempt: number;
}

export interface EmailDeliveryPublisher {
  publish(message: EmailDispatchMessage): Promise<void>;
}

export interface EmailDispatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly deferred: number;
}

export const CLAIM_EMAIL_DISPATCH_SQL = `
  SELECT delivery_id, dispatch_attempt
  FROM private.claim_api_email_dispatch_batch(
    $1::uuid,
    $2::integer,
    $3::integer,
    $4::uuid
  )
`;

export const COMPLETE_EMAIL_DISPATCH_SQL = `
  SELECT private.complete_api_email_dispatch(
    $1::uuid,
    $2::uuid,
    $3::timestamptz
  ) AS completed
`;

export const RETRY_EMAIL_DISPATCH_SQL = `
  SELECT private.retry_api_email_dispatch(
    $1::uuid,
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
    readonly deliveryId?: string;
  },
): Promise<ClaimedEmailDispatch[]> {
  const result = await transaction.query<ClaimedEmailDispatchRow>(CLAIM_EMAIL_DISPATCH_SQL, [
    input.leaseToken,
    input.limit,
    30,
    input.deliveryId ?? null,
  ]);
  return result.rows.map((unknownRow) => {
    const row = claimedEmailDispatchRowSchema.parse(unknownRow);
    return { deliveryId: row.delivery_id, attempt: row.dispatch_attempt };
  });
}

function retryDelaySeconds(attempt: number): number {
  const cap = Math.min(3_600, 2 ** Math.min(attempt, 11));
  return randomInt(1, cap + 1);
}

function safeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 2_000);
  return "Email dispatch failed";
}

export async function dispatchPendingEmailDeliveries(
  database: ApiDatabaseRuntime,
  publisher: EmailDeliveryPublisher,
  input: {
    readonly userId: string;
    readonly deliveryId?: string;
    readonly limit?: number;
  },
): Promise<EmailDispatchResult> {
  const leaseToken = randomUUID();
  const limit = Math.min(100, Math.max(1, input.limit ?? (input.deliveryId ? 1 : 20)));
  const deliveries = await database.withTransaction(
    { userId: input.userId },
    (transaction) => claimDispatches(transaction, {
      leaseToken,
      limit,
      ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }),
    }),
  );
  let published = 0;
  let deferred = 0;

  for (const delivery of deliveries) {
    try {
      await publisher.publish(
        EmailDispatchMessageSchema.parse({ deliveryId: delivery.deliveryId }),
      );
      await database.withTransaction({ userId: input.userId }, async (transaction) => {
        const result = await transaction.query<{ completed: boolean }>(
          COMPLETE_EMAIL_DISPATCH_SQL,
          [delivery.deliveryId, leaseToken, new Date()],
        );
        if (result.rows[0]?.completed !== true) {
          throw new Error("Email dispatch lease was lost before completion");
        }
      });
      published += 1;
    } catch (error) {
      await database.withTransaction({ userId: input.userId }, async (transaction) => {
        const result = await transaction.query<{ deferred: boolean }>(
          RETRY_EMAIL_DISPATCH_SQL,
          [delivery.deliveryId, leaseToken, safeError(error), retryDelaySeconds(delivery.attempt)],
        );
        if (result.rows[0]?.deferred !== true) {
          throw new Error("Email dispatch lease was lost before retry scheduling");
        }
      });
      deferred += 1;
    }
  }

  return { claimed: deliveries.length, published, deferred };
}
