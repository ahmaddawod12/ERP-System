import {
  ApiFailureResponseSchema,
  BusinessProfileSchema,
  BusinessProfileUpdateRequestSchema,
  ViewerProfileSchema,
  ViewerProfileUpdateRequestSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type FirebaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
} from "../idempotency/repository.js";
import {
  readBusinessProfile,
  readViewerProfile,
  updateBusinessProfile,
  updateViewerProfile,
} from "../profiles/repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const viewerProfileQuerySchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const viewerProfileResponseSchema = createApiSuccessResponseSchema(ViewerProfileSchema);
const businessProfileResponseSchema = createApiSuccessResponseSchema(BusinessProfileSchema);

export interface ProfileRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly firebaseUsers: FirebaseUserClient;
}

type ProfileOperation = "viewer" | "company";

function mapProfileDatabaseError(error: unknown, operation: ProfileOperation): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("COMPANY_PROFILE_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The company profile changed before this request was applied.",
      fieldErrors: { entityVersion: ["Reload the company profile and try again."] },
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("PROFILE_USER_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "PROFILE_NOT_FOUND",
      message: "The authenticated user profile was not found.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("PROFILE")) {
    return new AppError({
      statusCode: 404,
      code: "COMPANY_PROFILE_NOT_FOUND",
      message: "The company profile was not found.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: operation === "company" ? "COMPANY_PROFILE_FORBIDDEN" : "PROFILE_UPDATE_FORBIDDEN",
      message: operation === "company"
        ? "A manager or developer is required to change this company profile."
        : "You are not allowed to change this profile.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("PROFILE")) {
    return new AppError({
      statusCode: 400,
      code: operation === "company" ? "INVALID_COMPANY_PROFILE" : "INVALID_PROFILE",
      message: operation === "company"
        ? "The company profile update contains invalid fields."
        : "The profile update contains invalid fields.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerProfileRoutes(
  app: FastifyInstance,
  services: ProfileRouteServices,
): void {
  app.get(
    "/api/v1/me/profile",
    {
      schema: {
        tags: ["viewer", "profile"],
        summary: "Read the authenticated user's profile",
        querystring: viewerProfileQuerySchema,
        response: {
          200: viewerProfileResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const query = viewerProfileQuerySchema.parse(request.query);

      try {
        const profile = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = query.companyId === undefined
              ? null
              : await resolveTenantContext(
                  transaction,
                  authenticated.userId,
                  query.companyId,
                );
            return readViewerProfile(transaction, {
              userId: authenticated.userId,
              publicCompanyId: tenant?.workspace.companyId ?? null,
            });
          },
        );
        return apiSuccess(request.id, profile);
      } catch (error) {
        throw mapProfileDatabaseError(error, "viewer");
      }
    },
  );

  app.patch(
    "/api/v1/me/profile",
    {
      schema: {
        tags: ["viewer", "profile"],
        summary: "Update the authenticated user's profile",
        headers: mutationHeadersSchema,
        body: ViewerProfileUpdateRequestSchema,
        response: {
          200: viewerProfileResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = ViewerProfileUpdateRequestSchema.parse(request.body);

      try {
        const profile = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = body.companyId === undefined
              ? null
              : await resolveTenantContext(
                  transaction,
                  authenticated.userId,
                  body.companyId,
                );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant?.internalCompanyId ?? null,
              operation: "profile.viewer.update",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) return ViewerProfileSchema.parse(claim.responseBody);

            const updated = await updateViewerProfile(transaction, {
              internalCompanyId: tenant?.internalCompanyId ?? null,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, updated);
            return updated;
          },
        );
        return apiSuccess(request.id, profile);
      } catch (error) {
        throw mapProfileDatabaseError(error, "viewer");
      }
    },
  );

  app.get(
    "/api/v1/companies/:companyId/profile",
    {
      schema: {
        tags: ["workspaces", "profile"],
        summary: "Read a company profile for an authorized workspace member",
        params: companyParamsSchema,
        response: {
          200: businessProfileResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const params = companyParamsSchema.parse(request.params);

      try {
        const profile = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              params.companyId,
            );
            return readBusinessProfile(transaction, tenant.internalCompanyId);
          },
        );
        return apiSuccess(request.id, profile);
      } catch (error) {
        throw mapProfileDatabaseError(error, "company");
      }
    },
  );

  app.patch(
    "/api/v1/companies/:companyId/profile",
    {
      schema: {
        tags: ["workspaces", "profile"],
        summary: "Update a company profile as a manager or developer",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: BusinessProfileUpdateRequestSchema,
        response: {
          200: businessProfileResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = BusinessProfileUpdateRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const profile = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              params.companyId,
            );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "profile.company.update",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return BusinessProfileSchema.parse(claim.responseBody);

            const updated = await updateBusinessProfile(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              expectedEntityVersion,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, updated);
            return updated;
          },
        );
        return apiSuccess(request.id, profile);
      } catch (error) {
        throw mapProfileDatabaseError(error, "company");
      }
    },
  );
}
