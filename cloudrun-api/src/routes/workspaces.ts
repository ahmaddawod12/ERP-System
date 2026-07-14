import {
  ApiFailureResponseSchema,
  WorkspaceSummarySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { listWorkspaceSummaries } from "../workspaces/repository.js";

const workspaceListResponseSchema = createApiSuccessResponseSchema(
  z.array(WorkspaceSummarySchema).max(200),
);

export interface WorkspaceRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
}

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  services: WorkspaceRouteServices,
): void {
  app.get(
    "/api/v1/workspaces",
    {
      schema: {
        tags: ["workspaces"],
        summary: "List workspaces visible to the authenticated user",
        response: {
          200: workspaceListResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const viewer = await services.authenticator.authenticate(request);
      const workspaces = await services.database.withTransaction(
        { userId: viewer.userId },
        (transaction) => listWorkspaceSummaries(transaction, viewer.userId),
      );
      return apiSuccess(request.id, workspaces);
    },
  );
}
