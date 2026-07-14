import {
  ApiFailureResponseSchema,
  UpgradeRequestCreateRequestSchema,
  UpgradeRequestListPageSchema,
  UpgradeRequestListQuerySchema,
  UpgradeRequestModerationRequestSchema,
  UpgradeRequestSummarySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type SupabaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  readCompletedIdempotencyKey,
} from "../idempotency/repository.js";
import { consumeUpgradeRequestRateLimit } from "../request-limits/repository.js";
import { resolveTenantContext } from "../tenancy/context.js";
import {
  createUpgradeRequest,
  listUpgradeRequests,
  moderateUpgradeRequest,
} from "../upgrade-requests/repository.js";

const requestParamsSchema = z.object({ requestId: z.uuid() }).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const summaryResponseSchema = createApiSuccessResponseSchema(UpgradeRequestSummarySchema);
const listResponseSchema = createApiSuccessResponseSchema(UpgradeRequestListPageSchema);

export interface UpgradeRequestRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
}

async function enforceUpgradeRateLimit(
  services: UpgradeRequestRouteServices,
  userId: string,
  reply: FastifyReply,
): Promise<void> {
  let rateLimit;
  try {
    rateLimit = await services.database.withTransaction(
      { userId },
      consumeUpgradeRequestRateLimit,
    );
  } catch (error) {
    throw new AppError({
      statusCode: 503,
      code: "UPGRADE_RATE_LIMIT_UNAVAILABLE",
      message: "Upgrade requests are temporarily unavailable. Try again.",
      retryable: true,
      cause: error,
    });
  }
  if (!rateLimit.allowed) {
    reply.header(
      "retry-after",
      String(Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1_000))),
    );
    throw new AppError({
      statusCode: 429,
      code: "UPGRADE_RATE_LIMITED",
      message: "Too many upgrade requests. Try again later.",
      retryable: true,
    });
  }
}

function mapUpgradeDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("UPGRADE_REQUEST_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The upgrade request changed before moderation was applied.",
      fieldErrors: { entityVersion: ["Reload the request and try again."] },
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("UPGRADE_REQUEST")) {
    return new AppError({
      statusCode: 404,
      code: "UPGRADE_REQUEST_NOT_FOUND",
      message: "The upgrade request was not found.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "UPGRADE_REQUEST_FORBIDDEN",
      message: "You are not allowed to perform this upgrade action.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("UPGRADE_REQUEST_ALREADY_APPLIED")) {
    return new AppError({
      statusCode: 409,
      code: "UPGRADE_REQUEST_ALREADY_APPLIED",
      message: "An applied upgrade request cannot be moved to another state.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("UPGRADE_CURRENT_TIER_MATCH")) {
    return new AppError({
      statusCode: 409,
      code: "UPGRADE_TIER_ALREADY_ACTIVE",
      message: "The requested tier is already active for this workspace.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("UPGRADE_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_UPGRADE_REQUEST",
      message: "The upgrade request contains invalid fields.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerUpgradeRequestRoutes(
  app: FastifyInstance,
  services: UpgradeRequestRouteServices,
): void {
  app.get(
    "/api/v1/upgrade-requests",
    {
      schema: {
        tags: ["upgrade-requests"],
        summary: "List upgrade requests as a developer",
        querystring: UpgradeRequestListQuerySchema,
        response: {
          200: listResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const query = UpgradeRequestListQuerySchema.parse(request.query);
      try {
        const page = await services.database.withTransaction(
          { userId: authenticated.userId },
          (transaction) => listUpgradeRequests(transaction, query),
        );
        return apiSuccess(request.id, page, page.nextCursor);
      } catch (error) {
        throw mapUpgradeDatabaseError(error);
      }
    },
  );

  app.post(
    "/api/v1/upgrade-requests",
    {
      schema: {
        tags: ["upgrade-requests"],
        summary: "Request a workspace tier change",
        headers: mutationHeadersSchema,
        body: UpgradeRequestCreateRequestSchema,
        response: {
          201: summaryResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = UpgradeRequestCreateRequestSchema.parse(request.body);

      try {
        const replay = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              body.companyId,
            );
            return readCompletedIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "upgrade.request.create",
              key: headers["idempotency-key"],
              request: body,
            });
          },
        );
        if (replay !== null) {
          return reply.code(201).send(apiSuccess(
            request.id,
            UpgradeRequestSummarySchema.parse(replay.responseBody),
          ));
        }
        await enforceUpgradeRateLimit(services, authenticated.userId, reply);
        const created = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              body.companyId,
            );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "upgrade.request.create",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) {
              return UpgradeRequestSummarySchema.parse(claim.responseBody);
            }
            const result = await createUpgradeRequest(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, result);
            return result;
          },
        );
        return reply.code(201).send(apiSuccess(request.id, created));
      } catch (error) {
        throw mapUpgradeDatabaseError(error);
      }
    },
  );

  app.patch(
    "/api/v1/upgrade-requests/:requestId",
    {
      schema: {
        tags: ["upgrade-requests"],
        summary: "Moderate and atomically apply an upgrade request as a developer",
        params: requestParamsSchema,
        headers: mutationHeadersSchema,
        body: UpgradeRequestModerationRequestSchema,
        response: {
          200: summaryResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = requestParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = UpgradeRequestModerationRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const moderated = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "upgrade.request.moderate",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) {
              return UpgradeRequestSummarySchema.parse(claim.responseBody);
            }
            const result = await moderateUpgradeRequest(transaction, {
              requestId: params.requestId,
              expectedEntityVersion,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, moderated);
      } catch (error) {
        throw mapUpgradeDatabaseError(error);
      }
    },
  );
}
