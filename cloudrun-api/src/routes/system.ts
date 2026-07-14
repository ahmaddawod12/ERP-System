import {
  ApiFailureResponseSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { apiFailure, apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import { safeErrorIdentity } from "../http/logging.js";

export type ReadinessCheck = () => Promise<void> | void;

const healthDataSchema = z.object({ status: z.literal("ok") }).strict();
const readinessDataSchema = z.object({ status: z.literal("ready") }).strict();
const healthResponseSchema = createApiSuccessResponseSchema(healthDataSchema);
const readinessResponseSchema = createApiSuccessResponseSchema(readinessDataSchema);

export interface SystemRouteOptions {
  readonly readinessCheck: ReadinessCheck;
}

export function registerSystemRoutes(app: FastifyInstance, options: SystemRouteOptions): void {
  app.get(
    "/healthz",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness check",
        response: { 200: healthResponseSchema },
      },
    },
    (request) => apiSuccess(request.id, { status: "ok" as const }),
  );

  app.get(
    "/readyz",
    {
      schema: {
        tags: ["system"],
        summary: "Readiness check",
        response: { 200: readinessResponseSchema, 503: ApiFailureResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await options.readinessCheck();
        return apiSuccess(request.id, { status: "ready" as const });
      } catch (cause) {
        request.log.warn(safeErrorIdentity(cause), "readiness check failed");
        const error = new AppError({
          statusCode: 503,
          code: "SERVICE_NOT_READY",
          message: "The service is not ready to accept traffic.",
          retryable: true,
          cause,
        });
        return reply.code(503).send(apiFailure(request.id, error.toApiError()));
      }
    },
  );
}
