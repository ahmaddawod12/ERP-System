import {
  ApiFailureResponseSchema,
  ViewerSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";

import {
  AuthError,
  type ApiRequestAuthenticator,
  type FirebaseUserClient,
} from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { readViewerDatabaseData } from "../viewer/repository.js";
import type { WebSessionService } from "../web-sessions/service.js";

const viewerResponseSchema = createApiSuccessResponseSchema(ViewerSchema);

export interface ViewerRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly firebaseUsers: FirebaseUserClient;
  readonly webSessions: Pick<WebSessionService, "currentSession">;
}

export function registerViewerRoutes(
  app: FastifyInstance,
  services: ViewerRouteServices,
): void {
  app.get(
    "/api/v1/me",
    {
      schema: {
        tags: ["viewer"],
        summary: "Load the authenticated viewer and workspace list",
        response: {
          200: viewerResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      if (authenticated.scheme === "smart-job-session") {
        const current = await services.webSessions.currentSession(
          authenticated.sessionToken,
        );
        if (current.viewer.uid !== authenticated.userId) {
          throw new AuthError("AUTHORIZATION_INVALID").toAppError();
        }
        return apiSuccess(request.id, current.viewer);
      }

      const [authUser, databaseData] = await Promise.all([
        services.firebaseUsers.getUser(authenticated.accessToken),
        services.database.withTransaction(
          { userId: authenticated.userId },
          (transaction) => readViewerDatabaseData(
            transaction,
            authenticated.userId,
          ),
        ),
      ]);

      if (authUser.userId !== authenticated.userId) {
        throw new AuthError("AUTHORIZATION_INVALID").toAppError();
      }

      return apiSuccess(request.id, ViewerSchema.parse({
        uid: authenticated.userId,
        email: authUser.email,
        displayName: databaseData.displayName,
        emailVerified: authUser.emailVerified,
        workspaces: databaseData.workspaces,
      }));
    },
  );
}
