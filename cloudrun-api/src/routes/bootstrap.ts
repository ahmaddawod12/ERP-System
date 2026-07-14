import {
  ApiFailureResponseSchema,
  CompanyBootstrapSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { readCompanyBootstrap } from "../bootstrap/repository.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { resolveTenantContext } from "../tenancy/context.js";

const bootstrapParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const bootstrapResponseSchema = createApiSuccessResponseSchema(CompanyBootstrapSchema);

export interface BootstrapRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerBootstrapRoutes(
  app: FastifyInstance,
  services: BootstrapRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/bootstrap",
    {
      schema: {
        tags: ["bootstrap"],
        summary: "Load a lightweight company bootstrap snapshot",
        params: bootstrapParamsSchema,
        response: {
          200: bootstrapResponseSchema,
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
      const params = bootstrapParamsSchema.parse(request.params);
      const bootstrap = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readCompanyBootstrap(
            transaction,
            tenant.internalCompanyId,
            tenant.workspace,
          );
        },
      );
      return apiSuccess(request.id, bootstrap);
    },
  );
}
