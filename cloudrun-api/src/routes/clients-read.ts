import {
  ApiFailureResponseSchema,
  ClientListPageSchema,
  ClientListQuerySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { readClientsPage } from "../clients/read-repository.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { resolveTenantContext } from "../tenancy/context.js";

const clientsParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const clientsResponseSchema = createApiSuccessResponseSchema(ClientListPageSchema);

export interface ClientsReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerClientsReadRoutes(
  app: FastifyInstance,
  services: ClientsReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/clients",
    {
      schema: {
        tags: ["clients"],
        summary: "List authorized company clients with stable cursor pagination",
        params: clientsParamsSchema,
        querystring: ClientListQuerySchema,
        response: {
          200: clientsResponseSchema,
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
      const params = clientsParamsSchema.parse(request.params);
      const query = ClientListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readClientsPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );
}
