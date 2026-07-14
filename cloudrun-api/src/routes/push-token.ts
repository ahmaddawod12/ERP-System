import {
  ApiFailureResponseSchema,
  PushTokenClearRequestSchema,
  PushTokenClearResultSchema,
  PushTokenUpsertRequestSchema,
  PushTokenUpsertResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type SupabaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  clearPushToken,
  upsertPushToken,
} from "../push-tokens/repository.js";

const upsertResponseSchema = createApiSuccessResponseSchema(PushTokenUpsertResultSchema);
const clearResponseSchema = createApiSuccessResponseSchema(PushTokenClearResultSchema);

export interface PushTokenRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
}

function mapPushTokenDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "P0002" && message.includes("PUSH_DEVICE_USER_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "PROFILE_NOT_FOUND",
      message: "The authenticated user profile was not found.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("PUSH_DEVICE_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_PUSH_TOKEN",
      message: "The push token registration is invalid.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "PUSH_TOKEN_FORBIDDEN",
      message: "The push token cannot be changed for this account.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerPushTokenRoutes(
  app: FastifyInstance,
  services: PushTokenRouteServices,
): void {
  app.post(
    "/api/v1/me/push-token",
    {
      schema: {
        tags: ["viewer", "notifications"],
        summary: "Register the authenticated user's mobile push token",
        body: PushTokenUpsertRequestSchema,
        response: {
          200: upsertResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const body = PushTokenUpsertRequestSchema.parse(request.body);

      try {
        const result = await services.database.withTransaction(
          { userId: authenticated.userId },
          (transaction) => upsertPushToken(transaction, body),
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapPushTokenDatabaseError(error);
      }
    },
  );

  app.delete(
    "/api/v1/me/push-token",
    {
      schema: {
        tags: ["viewer", "notifications"],
        summary: "Clear the authenticated user's mobile push token",
        body: PushTokenClearRequestSchema,
        response: {
          200: clearResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const body = PushTokenClearRequestSchema.parse(request.body);

      try {
        await services.database.withTransaction(
          { userId: authenticated.userId },
          (transaction) => clearPushToken(transaction, body.deviceId),
        );
        return apiSuccess(request.id, PushTokenClearResultSchema.parse({ cleared: true }));
      } catch (error) {
        throw mapPushTokenDatabaseError(error);
      }
    },
  );
}
