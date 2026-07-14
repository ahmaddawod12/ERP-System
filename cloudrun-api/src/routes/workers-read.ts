import {
  ApiFailureResponseSchema,
  WorkerListPageSchema,
  WorkerListQuerySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { readWorkersPage } from "../workers/read-repository.js";

const workersParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const workersResponseSchema = createApiSuccessResponseSchema(WorkerListPageSchema);

export interface WorkersReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerWorkersReadRoutes(
  app: FastifyInstance,
  services: WorkersReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/workers",
    {
      schema: {
        tags: ["workers"],
        summary: "List the authorized company team with stable cursor pagination",
        params: workersParamsSchema,
        querystring: WorkerListQuerySchema,
        response: {
          200: workersResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const params = workersParamsSchema.parse(request.params);
      const query = WorkerListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readWorkersPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );
}
