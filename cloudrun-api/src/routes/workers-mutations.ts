import {
  ApiFailureResponseSchema,
  WorkerDisableRequestSchema,
  WorkerSummarySchema,
  WorkerUpdateRequestSchema,
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
import { resolveTenantContext } from "../tenancy/context.js";
import {
  disableWorkerMembership,
  updateWorkerMembership,
} from "../workers/mutation-repository.js";

const workerMutationParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  memberNo: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const workerResponseSchema = createApiSuccessResponseSchema(WorkerSummarySchema);

export interface WorkerMutationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly firebaseUsers: FirebaseUserClient;
}

function mapWorkerMutationDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("WORKER_ENTITY_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The team member changed before this request was applied.",
      fieldErrors: { entityVersion: ["Reload the team member and try again."] },
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("WORKER_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "WORKER_NOT_FOUND",
      message: "The requested team member was not found.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("WORKER_COMPANY_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "WORKSPACE_NOT_FOUND",
      message: "The requested workspace was not found.",
      cause: error,
    });
  }
  if (code === "23503" && message.includes("WORKER_HAS_ACTIVE_JOBS")) {
    return new AppError({
      statusCode: 409,
      code: "WORKER_HAS_ACTIVE_JOBS",
      message: "Reassign or finish this member's active jobs before disabling access.",
      cause: error,
    });
  }
  if (code === "23503" && message.includes("WORKER_HAS_INVENTORY")) {
    return new AppError({
      statusCode: 409,
      code: "WORKER_HAS_INVENTORY",
      message: "Transfer this member's remaining inventory before disabling access.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("WORKERS_MODULE_DISABLED")) {
    return new AppError({
      statusCode: 403,
      code: "WORKERS_MODULE_DISABLED",
      message: "Team management is not enabled for this workspace.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "WORKER_MUTATION_FORBIDDEN",
      message: "A workspace manager is required to change team members.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("WORKER")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_WORKER_MEMBERSHIP",
      message: "The team-member change contains invalid fields.",
      cause: error,
    });
  }
  if (code === "23505") {
    return new AppError({
      statusCode: 409,
      code: "WORKER_MEMBERSHIP_CONFLICT",
      message: "The team membership conflicts with another concurrent change.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerWorkerMutationRoutes(
  app: FastifyInstance,
  services: WorkerMutationRouteServices,
): void {
  app.patch(
    "/api/v1/companies/:companyId/workers/:memberNo",
    {
      schema: {
        tags: ["workers"],
        summary: "Update a team membership with optimistic concurrency",
        params: workerMutationParamsSchema,
        headers: mutationHeadersSchema,
        body: WorkerUpdateRequestSchema,
        response: {
          200: workerResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          425: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = workerMutationParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = WorkerUpdateRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const updated = await services.database.withTransaction(
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
              operation: "worker.update",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return WorkerSummarySchema.parse(claim.responseBody);

            const result = await updateWorkerMembership(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              memberNo: params.memberNo,
              expectedEntityVersion,
              request: body,
              updatedAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, updated);
      } catch (error) {
        throw mapWorkerMutationDatabaseError(error);
      }
    },
  );

  app.delete(
    "/api/v1/companies/:companyId/workers/:memberNo",
    {
      schema: {
        tags: ["workers"],
        summary: "Disable a team membership without deleting its history",
        params: workerMutationParamsSchema,
        headers: mutationHeadersSchema,
        body: WorkerDisableRequestSchema,
        response: {
          200: workerResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          425: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = workerMutationParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = WorkerDisableRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const disabled = await services.database.withTransaction(
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
              operation: "worker.disable",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return WorkerSummarySchema.parse(claim.responseBody);

            const result = await disableWorkerMembership(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              memberNo: params.memberNo,
              expectedEntityVersion,
              disabledAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, disabled);
      } catch (error) {
        throw mapWorkerMutationDatabaseError(error);
      }
    },
  );
}
