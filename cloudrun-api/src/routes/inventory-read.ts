import {
  ApiFailureResponseSchema,
  InventoryListPageSchema,
  InventoryListQuerySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import {
  readCompanyInventoryPage,
  readViewerInventoryPage,
} from "../inventory/read-repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const inventoryParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const inventoryResponseSchema = createApiSuccessResponseSchema(InventoryListPageSchema);

export interface InventoryReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerInventoryReadRoutes(
  app: FastifyInstance,
  services: InventoryReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/inventory",
    {
      schema: {
        tags: ["inventory"],
        summary: "List authorized company inventory with stable cursor pagination",
        params: inventoryParamsSchema,
        querystring: InventoryListQuerySchema,
        response: {
          200: inventoryResponseSchema,
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
      const params = inventoryParamsSchema.parse(request.params);
      const query = InventoryListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readCompanyInventoryPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/inventory/me",
    {
      schema: {
        tags: ["inventory"],
        summary: "List the authenticated member's inventory with stable cursor pagination",
        params: inventoryParamsSchema,
        querystring: InventoryListQuerySchema,
        response: {
          200: inventoryResponseSchema,
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
      const params = inventoryParamsSchema.parse(request.params);
      const query = InventoryListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readViewerInventoryPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );
}
