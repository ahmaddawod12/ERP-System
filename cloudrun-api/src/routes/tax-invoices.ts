import {
  ApiFailureResponseSchema,
  TaxInvoiceAcceptedSchema,
  TaxInvoiceCreateRequestSchema,
  createApiSuccessResponseSchema,
  type TaxSubmissionMode,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type FirebaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import { claimIdempotencyKey, completeIdempotencyClaim } from "../idempotency/repository.js";
import { createTaxInvoice } from "../tax/submission-repository.js";
import type { TaxGatewayClient } from "../tax/gateway-client.js";
import { resolveTenantContext } from "../tenancy/context.js";

const paramsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const headersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const acceptedResponseSchema = createApiSuccessResponseSchema(TaxInvoiceAcceptedSchema);

export interface TaxInvoiceRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly firebaseUsers: FirebaseUserClient;
  readonly taxSubmissionMode?: TaxSubmissionMode;
  readonly taxGatewayClient?: TaxGatewayClient;
}

function mapTaxInvoiceError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const value = error && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : undefined;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof value?.message === "string" ? value.message : "";
  if (code === "22023") {
    return new AppError({
      statusCode: 400,
      code: "INVALID_TAX_INVOICE",
      message: message.includes("TAX_INVOICE_AMOUNT_INVALID")
        ? "Tax invoice quantities and prices must be positive and within supported limits."
        : "The tax invoice contains invalid data.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "TAX_INVOICE_FORBIDDEN",
      message: "You are not allowed to create tax invoices in this workspace.",
      cause: error,
    });
  }
  if (code === "P0002") {
    return new AppError({
      statusCode: 404,
      code: "TAX_INVOICE_REFERENCE_NOT_FOUND",
      message: "A referenced workspace, client, or inventory part was not found.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerTaxInvoiceRoutes(
  app: FastifyInstance,
  services: TaxInvoiceRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/tax-invoices",
    {
      schema: {
        tags: ["tax-invoices"],
        summary: "Reserve and queue an authoritative tax invoice",
        params: paramsSchema,
        headers: headersSchema,
        body: TaxInvoiceCreateRequestSchema,
        response: {
          202: acceptedResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          425: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
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
          code: "TAX_SUBMISSION_UNAVAILABLE",
          message: "Tax submission is temporarily unavailable.",
          retryable: true,
        });
      }
      const params = paramsSchema.parse(request.params);
      const headers = headersSchema.parse(request.headers);
      const body = TaxInvoiceCreateRequestSchema.parse(request.body);
      try {
        const accepted = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              params.companyId,
            );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "tax-invoice.create",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return TaxInvoiceAcceptedSchema.parse(claim.responseBody);
            const result = await createTaxInvoice(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
              createdAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 202, result);
            return result;
          },
        );
        reply.code(202);
        return apiSuccess(request.id, accepted);
      } catch (error) {
        throw mapTaxInvoiceError(error);
      }
    },
  );
}
