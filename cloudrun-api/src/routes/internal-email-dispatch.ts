import {
  ApiFailureResponseSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { GoogleServiceIdentityVerifier } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import {
  dispatchPendingEmailDeliveries,
  type EmailDeliveryPublisher,
} from "../documents/email-dispatch.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";

const drainRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
}).strict().default({ limit: 20 });
const drainResultSchema = z.object({
  claimed: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
}).strict();
const drainResponseSchema = createApiSuccessResponseSchema(drainResultSchema);

export interface InternalEmailDispatchRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly emailDeliveryPublisher?: EmailDeliveryPublisher;
  readonly internalIdentityVerifier?: GoogleServiceIdentityVerifier;
}

export function registerInternalEmailDispatchRoute(
  app: FastifyInstance,
  services: InternalEmailDispatchRouteServices,
): void {
  app.post(
    "/internal/v1/email-dispatch/drain",
    {
      schema: {
        tags: ["internal"],
        summary: "Lease and publish pending document email deliveries",
        body: drainRequestSchema,
        response: {
          200: drainResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      if (
        services.internalIdentityVerifier === undefined
        || services.emailDeliveryPublisher === undefined
      ) {
        throw new AppError({
          statusCode: 503,
          code: "EMAIL_DISPATCH_UNAVAILABLE",
          message: "Email dispatch is not configured.",
          retryable: true,
        });
      }
      const identity = await services.internalIdentityVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
      const body = drainRequestSchema.parse(request.body);
      const result = await dispatchPendingEmailDeliveries(
        services.database,
        services.emailDeliveryPublisher,
        { userId: identity.contextUserId, limit: body.limit },
      );
      return apiSuccess(request.id, drainResultSchema.parse(result));
    },
  );
}
