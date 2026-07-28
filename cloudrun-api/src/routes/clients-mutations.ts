import {
  ApiFailureResponseSchema,
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteResultSchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type FirebaseUserClient,
} from "../auth/index.js";
import {
  createClient,
  deleteOrArchiveClient,
  updateClient,
} from "../clients/mutation-repository.js";
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

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const clientParamsSchema = companyParamsSchema.extend({
  clientId: z.uuid(),
}).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const clientResponseSchema = createApiSuccessResponseSchema(ClientSummarySchema);
const removalResponseSchema = createApiSuccessResponseSchema(ClientDeleteResultSchema);

export interface ClientMutationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly firebaseUsers: FirebaseUserClient;
}

function mapClientMutationDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("CLIENT_ENTITY_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The client changed before this request was applied.",
      fieldErrors: { entityVersion: ["Reload the client and try again."] },
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("CLIENT_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "CLIENT_NOT_FOUND",
      message: "The requested client was not found.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("CLIENTS_MODULE_DISABLED")) {
    return new AppError({
      statusCode: 403,
      code: "CLIENTS_MODULE_DISABLED",
      message: "Clients are not enabled for this workspace.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "CLIENT_MUTATION_FORBIDDEN",
      message: "You are not allowed to change clients in this workspace.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("CLIENT")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_CLIENT",
      message: "The client contains invalid fields.",
      cause: error,
    });
  }
  if (code === "23505") {
    return new AppError({
      statusCode: 409,
      code: "CLIENT_CONFLICT",
      message: "The client conflicts with another concurrent change.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerClientMutationRoutes(
  app: FastifyInstance,
  services: ClientMutationRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/clients",
    {
      schema: {
        tags: ["clients"],
        summary: "Create a company client with a sequential client number",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: ClientCreateRequestSchema,
        response: {
          201: clientResponseSchema,
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
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = ClientCreateRequestSchema.parse(request.body);

      try {
        const created = await services.database.withTransaction(
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
              operation: "client.create",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return ClientSummarySchema.parse(claim.responseBody);

            const result = await createClient(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
              createdAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, result);
            return result;
          },
        );
        reply.code(201);
        return apiSuccess(request.id, created);
      } catch (error) {
        throw mapClientMutationDatabaseError(error);
      }
    },
  );

  app.patch(
    "/api/v1/companies/:companyId/clients/:clientId",
    {
      schema: {
        tags: ["clients"],
        summary: "Update or archive a company client with optimistic concurrency",
        params: clientParamsSchema,
        headers: mutationHeadersSchema,
        body: ClientUpdateRequestSchema,
        response: {
          200: clientResponseSchema,
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
      const params = clientParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = ClientUpdateRequestSchema.parse(request.body);
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
              operation: "client.update",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return ClientSummarySchema.parse(claim.responseBody);

            const result = await updateClient(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              clientId: params.clientId,
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
        throw mapClientMutationDatabaseError(error);
      }
    },
  );

  app.delete(
    "/api/v1/companies/:companyId/clients/:clientId",
    {
      schema: {
        tags: ["clients"],
        summary: "Delete an unreferenced client or archive a referenced client",
        params: clientParamsSchema,
        headers: mutationHeadersSchema,
        body: ClientDeleteRequestSchema,
        response: {
          200: removalResponseSchema,
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
      const params = clientParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = ClientDeleteRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const removed = await services.database.withTransaction(
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
              operation: "client.delete",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return ClientDeleteResultSchema.parse(claim.responseBody);

            const result = await deleteOrArchiveClient(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              clientId: params.clientId,
              expectedEntityVersion,
              removedAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, removed);
      } catch (error) {
        throw mapClientMutationDatabaseError(error);
      }
    },
  );
}
