import {
  ApiFailureResponseSchema,
  BusinessRegistrationRequestSchema,
  BusinessRegistrationResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  AuthError,
  type ApiRequestAuthenticator,
  type AuthenticatedApiRequest,
  type FirebaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
} from "../idempotency/repository.js";
import { registerBusinessAccount } from "../registration/repository.js";
import type { WebSessionService } from "../web-sessions/service.js";
import { listWorkspaceSummaries } from "../workspaces/repository.js";

const registrationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const registrationResponseSchema = createApiSuccessResponseSchema(
  BusinessRegistrationResultSchema,
);

export interface BusinessRegistrationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly firebaseUsers: FirebaseUserClient;
  readonly webSessions: Pick<WebSessionService, "currentSession">;
}

function verifiedEmailRequired(): AppError {
  return new AppError({
    statusCode: 403,
    code: "VERIFIED_EMAIL_REQUIRED",
    message: "Verify an email address before creating a workspace.",
  });
}

async function readVerifiedEmail(
  authenticated: AuthenticatedApiRequest,
  services: BusinessRegistrationRouteServices,
): Promise<string> {
  if (authenticated.scheme === "bearer") {
    const user = await services.firebaseUsers.getUser(authenticated.accessToken);
    if (user.userId !== authenticated.userId) {
      throw new AuthError("AUTHORIZATION_INVALID").toAppError();
    }
    if (!user.emailVerified || user.email === null) throw verifiedEmailRequired();
    return user.email.toLowerCase();
  }

  const session = await services.webSessions.currentSession(authenticated.sessionToken);
  if (session.viewer.uid !== authenticated.userId) {
    throw new AuthError("AUTHORIZATION_INVALID").toAppError();
  }
  if (!session.viewer.emailVerified || session.viewer.email === null) {
    throw verifiedEmailRequired();
  }
  return session.viewer.email.toLowerCase();
}

export function registerBusinessRegistrationRoutes(
  app: FastifyInstance,
  services: BusinessRegistrationRouteServices,
): void {
  app.post(
    "/api/v1/auth/business-registration",
    {
      schema: {
        tags: ["auth", "workspaces"],
        summary: "Create the authenticated user's first workspace atomically",
        headers: registrationHeadersSchema,
        body: BusinessRegistrationRequestSchema,
        response: {
          201: registrationResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      const verifiedEmail = await readVerifiedEmail(authenticated, services);
      const headers = registrationHeadersSchema.parse(request.headers);
      const body = BusinessRegistrationRequestSchema.parse(request.body);

      try {
        const registered = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "business.register",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) {
              return BusinessRegistrationResultSchema.parse(claim.responseBody);
            }

            const created = await registerBusinessAccount(transaction, {
              verifiedEmail,
              request: body,
            });
            const workspaces = await listWorkspaceSummaries(
              transaction,
              authenticated.userId,
            );
            const workspace = workspaces.find(
              (candidate) => candidate.companyId === created.publicCompanyId,
            );
            if (workspace === undefined) {
              throw new Error("Registered workspace could not be read back");
            }

            const result = BusinessRegistrationResultSchema.parse({
              workspace,
              tier: created.tier,
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, result);
            return result;
          },
        );

        reply.code(201);
        return apiSuccess(request.id, registered);
      } catch (error) {
        throw mapDatabaseError(error, "business.register");
      }
    },
  );
}
