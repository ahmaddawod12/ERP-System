import {
  ApiFailureResponseSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { GoogleServiceIdentityVerifier } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import {
  dispatchPendingDocumentTasks,
  type DocumentTaskPublisher,
} from "../documents/dispatch.js";
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

export interface InternalDocumentDispatchRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly documentTaskPublisher?: DocumentTaskPublisher;
  readonly internalIdentityVerifier?: GoogleServiceIdentityVerifier;
}

export function registerInternalDocumentDispatchRoute(
  app: FastifyInstance,
  services: InternalDocumentDispatchRouteServices,
): void {
  app.post(
    "/internal/v1/document-dispatch/drain",
    {
      schema: {
        tags: ["internal"],
        summary: "Lease and publish pending document tasks",
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
        || services.documentTaskPublisher === undefined
      ) {
        throw new AppError({
          statusCode: 503,
          code: "DOCUMENT_DISPATCH_UNAVAILABLE",
          message: "Document dispatch is not configured.",
          retryable: true,
        });
      }
      const identity = await services.internalIdentityVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
      const body = drainRequestSchema.parse(request.body);
      const result = await dispatchPendingDocumentTasks(
        services.database,
        services.documentTaskPublisher,
        { userId: identity.contextUserId, limit: body.limit },
      );
      return apiSuccess(request.id, drainResultSchema.parse(result));
    },
  );
}
