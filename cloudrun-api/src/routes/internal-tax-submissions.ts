import { ApiFailureResponseSchema, createApiSuccessResponseSchema, type TaxSubmissionMode } from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { GoogleServiceIdentityVerifier } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { dispatchPendingDocumentTasks, type DocumentTaskPublisher } from "../documents/dispatch.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  TaxGatewayPreSendError,
  type TaxGatewayClient,
} from "../tax/gateway-client.js";
import {
  claimTaxSubmissions,
  markTaxSubmissionUnknown,
  processTaxSubmissionResult,
  retryTaxSubmission,
} from "../tax/submission-repository.js";

const requestSchema = z.object({
  limit: z.number().int().min(1).max(10).default(1),
}).strict();
const resultSchema = z.object({
  claimed: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  submissionUnknown: z.number().int().nonnegative(),
}).strict();
const responseSchema = createApiSuccessResponseSchema(resultSchema);

export interface InternalTaxSubmissionServices {
  readonly database: ApiDatabaseRuntime;
  readonly internalIdentityVerifier?: GoogleServiceIdentityVerifier;
  readonly taxSubmissionMode?: TaxSubmissionMode;
  readonly taxGatewayClient?: TaxGatewayClient;
  readonly documentTaskPublisher?: DocumentTaskPublisher;
}

export function registerInternalTaxSubmissionRoutes(
  app: FastifyInstance,
  services: InternalTaxSubmissionServices,
): void {
  app.post(
    "/internal/v1/tax-submissions/drain",
    {
      schema: {
        tags: ["internal"],
        summary: "Claim and submit bounded tax-authority outbox work",
        body: requestSchema,
        response: {
          200: responseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (services.internalIdentityVerifier === undefined) {
        throw new AppError({
          statusCode: 503,
          code: "INTERNAL_IDENTITY_UNAVAILABLE",
          message: "Internal tax submission identity is not configured.",
          retryable: true,
        });
      }
      const identity = await services.internalIdentityVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
      if ((services.taxSubmissionMode ?? "disabled") === "disabled") {
        throw new AppError({
          statusCode: 503,
          code: "TAX_SUBMISSION_DISABLED",
          message: "Tax submission is unavailable pending certification.",
          retryable: false,
        });
      }
      if (services.taxGatewayClient === undefined) {
        throw new AppError({
          statusCode: 503,
          code: "TAX_GATEWAY_UNAVAILABLE",
          message: "Tax gateway is not configured.",
          retryable: true,
        });
      }
      const body = requestSchema.parse(request.body);
      const submissions = await services.database.withTransaction(
        { userId: identity.contextUserId },
        (transaction) => claimTaxSubmissions(transaction, {
          limit: body.limit,
          leaseSeconds: 60,
        }),
      );
      let processed = 0;
      let deferred = 0;
      let submissionUnknown = 0;

      for (const submission of submissions) {
        try {
          const result = await services.taxGatewayClient.requestApproval({
            documentId: submission.documentId,
            correlationId: submission.correlationId,
            invoice: submission.invoice,
          });
          await services.database.withTransaction(
            { userId: identity.contextUserId },
            (transaction) => processTaxSubmissionResult(transaction, submission, result),
          );
          processed += 1;
        } catch (error) {
          if (error instanceof TaxGatewayPreSendError) {
            await services.database.withTransaction(
              { userId: identity.contextUserId },
              (transaction) => retryTaxSubmission(transaction, submission, error),
            );
            deferred += 1;
          } else {
            await services.database.withTransaction(
              { userId: identity.contextUserId },
              (transaction) => markTaxSubmissionUnknown(transaction, submission, error),
            );
            submissionUnknown += 1;
          }
        }
      }

      if (processed > 0 && services.documentTaskPublisher !== undefined) {
        try {
          await dispatchPendingDocumentTasks(
            services.database,
            services.documentTaskPublisher,
            { userId: identity.contextUserId, limit: processed },
          );
        } catch (error) {
          request.log.warn({ err: error }, "approved tax PDF remains in the document outbox");
        }
      }
      return apiSuccess(request.id, resultSchema.parse({
        claimed: submissions.length,
        processed,
        deferred,
        submissionUnknown,
      }));
    },
  );
}
