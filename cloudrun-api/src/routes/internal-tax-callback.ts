import {
  ApiFailureResponseSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { GoogleServiceIdentityVerifier } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { mapDatabaseError } from "../database/errors.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";

const taxCallbackDataSchema = z.object({
  oauthSessionId: z.string().trim().min(1).max(128),
  status: z.enum(["approved", "rejected", "error"]),
  confirmationNumber: z.string().trim().min(1).max(128).optional(),
  errorCode: z.string().trim().min(1).max(128).optional(),
  errorMessage: z.string().trim().min(1).max(2_000).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

const taxCallbackRequestSchema = z.object({
  eventId: z.string().trim().min(8).max(128),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  callback: taxCallbackDataSchema,
}).strict();

const taxCallbackResultSchema = z.object({
  processed: z.literal(true),
  idempotentReplay: z.boolean().optional(),
}).strict();
const taxCallbackResponseSchema = createApiSuccessResponseSchema(taxCallbackResultSchema);

const taxApprovalSessionRequestSchema = z.object({
  documentId: z.uuid(),
  oauthSessionId: z.string().trim().min(1).max(128),
}).strict();
const taxApprovalSessionResultSchema = z.object({
  bound: z.literal(true),
  idempotentReplay: z.boolean(),
}).strict();
const taxApprovalSessionResponseSchema = createApiSuccessResponseSchema(
  taxApprovalSessionResultSchema,
);

const PROCESS_TAX_CALLBACK_SQL = `
  SELECT processed, idempotent_replay
  FROM private.process_api_tax_callback(
    $1::varchar,
    $2::varchar(64),
    $3::varchar(128),
    $4::varchar(32),
    $5::varchar(128),
    $6::varchar(128),
    $7::text,
    $8::timestamptz
  )
`;

interface TaxCallbackRow {
  readonly processed: boolean;
  readonly idempotent_replay: boolean;
}

interface TaxApprovalSessionRow {
  readonly bound: boolean;
  readonly idempotent_replay: boolean;
}

export interface InternalTaxCallbackRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly internalIdentityVerifier?: GoogleServiceIdentityVerifier;
}

export function registerInternalTaxCallbackRoute(
  app: FastifyInstance,
  services: InternalTaxCallbackRouteServices,
): void {
  app.post(
    "/internal/v1/tax/approval-session",
    {
      schema: {
        tags: ["internal"],
        summary: "Bind a tax approval correlation ID to its invoice reservation",
        body: taxApprovalSessionRequestSchema,
        response: {
          200: taxApprovalSessionResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (services.internalIdentityVerifier === undefined) {
        throw new AppError({
          statusCode: 503,
          code: "TAX_APPROVAL_UNAVAILABLE",
          message: "Tax approval processing is not configured.",
          retryable: true,
        });
      }
      const identity = await services.internalIdentityVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
      const body = taxApprovalSessionRequestSchema.parse(request.body);
      const result = await services.database.withTransaction(
        { userId: identity.contextUserId },
        async (transaction) => {
          const queryResult = await transaction.query<TaxApprovalSessionRow>(
            `SELECT bound, idempotent_replay
             FROM private.bind_api_tax_approval_session($1::uuid, $2::varchar(128))`,
            [body.documentId, body.oauthSessionId],
          );
          const row = queryResult.rows[0];
          if (row === undefined) {
            throw new AppError({
              statusCode: 500,
              code: "TAX_APPROVAL_BINDING_FAILED",
              message: "The tax approval session could not be bound.",
              retryable: true,
            });
          }
          return taxApprovalSessionResultSchema.parse({
            bound: row.bound,
            idempotentReplay: row.idempotent_replay,
          });
        },
      ).catch((error: unknown) => {
        throw mapDatabaseError(error);
      });
      return apiSuccess(request.id, result);
    },
  );

  app.post(
    "/internal/v1/tax/callback",
    {
      schema: {
        tags: ["internal"],
        summary: "Process a forwarded tax-authority callback",
        body: taxCallbackRequestSchema,
        response: {
          200: taxCallbackResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (services.internalIdentityVerifier === undefined) {
        throw new AppError({
          statusCode: 503,
          code: "TAX_CALLBACK_UNAVAILABLE",
          message: "Tax callback processing is not configured.",
          retryable: true,
        });
      }
      const identity = await services.internalIdentityVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
      const body = taxCallbackRequestSchema.parse(request.body);

      const result = await services.database.withTransaction(
        { userId: identity.contextUserId },
        async (transaction) => {
          const queryResult = await transaction.query<TaxCallbackRow>(
            PROCESS_TAX_CALLBACK_SQL,
            [
              body.eventId,
              body.payloadHash,
              body.callback.oauthSessionId,
              body.callback.status,
              body.callback.confirmationNumber ?? null,
              body.callback.errorCode ?? null,
              body.callback.errorMessage ?? null,
              body.callback.occurredAt ?? null,
            ],
          );
          const row = queryResult.rows[0];
          if (row === undefined) {
            throw new AppError({
              statusCode: 500,
              code: "TAX_CALLBACK_PROCESSING_FAILED",
              message: "The tax callback could not be processed.",
              retryable: true,
            });
          }
          return taxCallbackResultSchema.parse({
            processed: row.processed,
            ...(row.idempotent_replay === undefined ? {} : { idempotentReplay: row.idempotent_replay }),
          });
        },
      ).catch((error: unknown) => {
        throw mapDatabaseError(error);
      });

      return apiSuccess(request.id, result);
    },
  );
}
