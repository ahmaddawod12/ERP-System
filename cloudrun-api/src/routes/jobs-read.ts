import {
  ApiFailureResponseSchema,
  JobListPageSchema,
  JobListQuerySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { readJobsPage } from "../jobs/read-repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const jobsParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const jobsResponseSchema = createApiSuccessResponseSchema(JobListPageSchema);

export interface JobsReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerJobsReadRoutes(
  app: FastifyInstance,
  services: JobsReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/jobs",
    {
      schema: {
        tags: ["jobs"],
        summary: "List authorized company jobs with stable cursor pagination",
        params: jobsParamsSchema,
        querystring: JobListQuerySchema,
        response: {
          200: jobsResponseSchema,
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
      const params = jobsParamsSchema.parse(request.params);
      const query = JobListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readJobsPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );
}
