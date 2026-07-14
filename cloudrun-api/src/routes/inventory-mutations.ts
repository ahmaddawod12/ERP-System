import {
  ApiFailureResponseSchema,
  InventoryAdjustmentRequestSchema,
  InventoryPartArchiveRequestSchema,
  InventoryPartCreateRequestSchema,
  InventoryPartSummarySchema,
  InventoryPartUpdateRequestSchema,
  InventoryPickRequestSchema,
  InventoryPickResultSchema,
  InventoryTransferRequestSchema,
  InventoryTransferResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type SupabaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
} from "../idempotency/repository.js";
import {
  adjustInventoryStock,
  archiveInventoryPart,
  createInventoryPart,
  pickInventoryStock,
  transferInventoryStock,
  updateInventoryPart,
} from "../inventory/mutation-repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const partParamsSchema = companyParamsSchema.extend({ partId: z.uuid() }).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const partResponseSchema = createApiSuccessResponseSchema(InventoryPartSummarySchema);
const transferResponseSchema = createApiSuccessResponseSchema(InventoryTransferResultSchema);
const pickResponseSchema = createApiSuccessResponseSchema(InventoryPickResultSchema);
const mutationResponses = {
  400: ApiFailureResponseSchema,
  401: ApiFailureResponseSchema,
  403: ApiFailureResponseSchema,
  404: ApiFailureResponseSchema,
  409: ApiFailureResponseSchema,
  425: ApiFailureResponseSchema,
  503: ApiFailureResponseSchema,
} as const;

export interface InventoryMutationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
}

function mapInventoryMutationDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("INVENTORY_")) {
    const stock = message.includes("STOCK_VERSION");
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The inventory changed before this request was applied.",
      fieldErrors: {
        [stock ? "stockEntityVersion" : "entityVersion"]: [
          "Reload inventory and try again.",
        ],
      },
      cause: error,
    });
  }
  if (code === "P0001" && message.toLowerCase().includes("inventory_insufficient_stock")) {
    return new AppError({
      statusCode: 409,
      code: "INSUFFICIENT_STOCK",
      message: "There is not enough stock to complete this operation.",
      cause: error,
    });
  }
  if (code === "P0001" && message.includes("INVENTORY_STOCK_REMAINS")) {
    return new AppError({
      statusCode: 409,
      code: "INVENTORY_STOCK_REMAINS",
      message: "Move or adjust all stock to zero before archiving this part.",
      cause: error,
    });
  }
  if (code === "40900" && message.includes("INVENTORY_PART_ARCHIVED")) {
    return new AppError({
      statusCode: 409,
      code: "INVENTORY_PART_ARCHIVED",
      message: "Archived inventory parts cannot be changed.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("INVENTORY_MEMBER")) {
    return new AppError({
      statusCode: 404,
      code: "INVENTORY_MEMBER_NOT_FOUND",
      message: "The requested active member was not found.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("INVENTORY_")) {
    return new AppError({
      statusCode: 404,
      code: "INVENTORY_NOT_FOUND",
      message: "The requested inventory resource was not found.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("INVENTORY_MODULE_DISABLED")) {
    return new AppError({
      statusCode: 403,
      code: "INVENTORY_MODULE_DISABLED",
      message: "Inventory is not enabled for this workspace.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("INVENTORY_")) {
    return new AppError({
      statusCode: 403,
      code: "INVENTORY_MUTATION_FORBIDDEN",
      message: "You are not allowed to change inventory in this workspace.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("INVENTORY_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_INVENTORY_MUTATION",
      message: "The inventory operation contains invalid fields.",
      cause: error,
    });
  }
  if (code === "23505" || code === "23514") {
    return new AppError({
      statusCode: 409,
      code: "INVENTORY_CONFLICT",
      message: "The inventory operation conflicts with a concurrent change.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

async function idempotentInventoryMutation<T>(input: {
  readonly services: InventoryMutationRouteServices;
  readonly userId: string;
  readonly publicCompanyId: number;
  readonly operation: string;
  readonly key: string;
  readonly request: unknown;
  readonly responseStatus: number;
  readonly responseSchema: z.ZodType<T>;
  readonly work: (transaction: DatabaseQueryable, internalCompanyId: string) => Promise<T>;
}): Promise<T> {
  return input.services.database.withTransaction(
    { userId: input.userId },
    async (transaction) => {
      const tenant = await resolveTenantContext(
        transaction,
        input.userId,
        input.publicCompanyId,
      );
      const claim = await claimIdempotencyKey(transaction, {
        userId: input.userId,
        internalCompanyId: tenant.internalCompanyId,
        operation: input.operation,
        key: input.key,
        request: input.request,
      });
      if (claim.replayed) return input.responseSchema.parse(claim.responseBody);
      const result = await input.work(transaction, tenant.internalCompanyId);
      await completeIdempotencyClaim(transaction, claim.id, input.responseStatus, result);
      return result;
    },
  );
}

export function registerInventoryMutationRoutes(
  app: FastifyInstance,
  services: InventoryMutationRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/inventory/parts",
    {
      schema: {
        tags: ["inventory"],
        summary: "Create a versioned company inventory part",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: InventoryPartCreateRequestSchema,
        response: { 201: partResponseSchema, ...mutationResponses },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = InventoryPartCreateRequestSchema.parse(request.body);
      try {
        const result = await idempotentInventoryMutation({
          services,
          userId: authenticated.userId,
          publicCompanyId: params.companyId,
          operation: "inventory.part.create",
          key: headers["idempotency-key"],
          request: { params, body },
          responseStatus: 201,
          responseSchema: InventoryPartSummarySchema,
          work: (transaction, internalCompanyId) => createInventoryPart(transaction, {
            internalCompanyId,
            request: body,
            createdAt: new Date(),
          }),
        });
        reply.code(201);
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapInventoryMutationDatabaseError(error);
      }
    },
  );

  app.patch(
    "/api/v1/companies/:companyId/inventory/parts/:partId",
    {
      schema: {
        tags: ["inventory"],
        summary: "Update inventory part metadata with optimistic concurrency",
        params: partParamsSchema,
        headers: mutationHeadersSchema,
        body: InventoryPartUpdateRequestSchema,
        response: { 200: partResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = partParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = InventoryPartUpdateRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);
      try {
        const result = await idempotentInventoryMutation({
          services,
          userId: authenticated.userId,
          publicCompanyId: params.companyId,
          operation: "inventory.part.update",
          key: headers["idempotency-key"],
          request: { params, body },
          responseStatus: 200,
          responseSchema: InventoryPartSummarySchema,
          work: (transaction, internalCompanyId) => updateInventoryPart(transaction, {
            internalCompanyId,
            partId: params.partId,
            expectedEntityVersion,
            request: body,
            updatedAt: new Date(),
          }),
        });
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapInventoryMutationDatabaseError(error);
      }
    },
  );

  app.delete(
    "/api/v1/companies/:companyId/inventory/parts/:partId",
    {
      schema: {
        tags: ["inventory"],
        summary: "Archive a zero-stock inventory part",
        params: partParamsSchema,
        headers: mutationHeadersSchema,
        body: InventoryPartArchiveRequestSchema,
        response: { 200: partResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = partParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = InventoryPartArchiveRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);
      try {
        const result = await idempotentInventoryMutation({
          services,
          userId: authenticated.userId,
          publicCompanyId: params.companyId,
          operation: "inventory.part.archive",
          key: headers["idempotency-key"],
          request: { params, body },
          responseStatus: 200,
          responseSchema: InventoryPartSummarySchema,
          work: (transaction, internalCompanyId) => archiveInventoryPart(transaction, {
            internalCompanyId,
            partId: params.partId,
            expectedEntityVersion,
            archivedAt: new Date(),
          }),
        });
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapInventoryMutationDatabaseError(error);
      }
    },
  );

  const registerAdjustment = (scope: "company" | "member", path: string) => {
    app.post(
      path,
      {
        schema: {
          tags: ["inventory"],
          summary: scope === "company"
            ? "Atomically adjust company stock"
            : "Atomically adjust the authenticated member's stock",
          params: partParamsSchema,
          headers: mutationHeadersSchema,
          body: InventoryAdjustmentRequestSchema,
          response: { 200: partResponseSchema, ...mutationResponses },
        },
      },
      async (request) => {
        const authenticated = await services.authenticator.authenticate(request);
        await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
        const params = partParamsSchema.parse(request.params);
        const headers = mutationHeadersSchema.parse(request.headers);
        const body = InventoryAdjustmentRequestSchema.parse(request.body);
        const expectedStockEntityVersion = decodeEntityVersion(body.stockEntityVersion);
        try {
          const result = await idempotentInventoryMutation({
            services,
            userId: authenticated.userId,
            publicCompanyId: params.companyId,
            operation: `inventory.${scope}.adjust`,
            key: headers["idempotency-key"],
            request: { params, body },
            responseStatus: 200,
            responseSchema: InventoryPartSummarySchema,
            work: (transaction, internalCompanyId) => adjustInventoryStock(transaction, {
              internalCompanyId,
              partId: params.partId,
              scope,
              expectedStockEntityVersion,
              request: body,
              adjustedAt: new Date(),
            }),
          });
          return apiSuccess(request.id, result);
        } catch (error) {
          throw mapInventoryMutationDatabaseError(error);
        }
      },
    );
  };
  registerAdjustment("company", "/api/v1/companies/:companyId/inventory/parts/:partId/adjustments");
  registerAdjustment("member", "/api/v1/companies/:companyId/inventory/me/parts/:partId/adjustments");

  app.post(
    "/api/v1/companies/:companyId/inventory/transfers",
    {
      schema: {
        tags: ["inventory"],
        summary: "Atomically transfer stock between company and member inventory",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: InventoryTransferRequestSchema,
        response: { 200: transferResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = InventoryTransferRequestSchema.parse(request.body);
      const expectedSourceStockEntityVersion = decodeEntityVersion(body.sourceStockEntityVersion);
      try {
        const result = await idempotentInventoryMutation({
          services,
          userId: authenticated.userId,
          publicCompanyId: params.companyId,
          operation: "inventory.transfer",
          key: headers["idempotency-key"],
          request: { params, body },
          responseStatus: 200,
          responseSchema: InventoryTransferResultSchema,
          work: (transaction, internalCompanyId) => transferInventoryStock(transaction, {
            internalCompanyId,
            expectedSourceStockEntityVersion,
            request: body,
            transferredAt: new Date(),
          }),
        });
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapInventoryMutationDatabaseError(error);
      }
    },
  );

  app.post(
    "/api/v1/companies/:companyId/inventory/picks",
    {
      schema: {
        tags: ["inventory"],
        summary: "Atomically pick a bounded batch of company stock for one member",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: InventoryPickRequestSchema,
        response: { 200: pickResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = InventoryPickRequestSchema.parse(request.body);
      const expectedVersions = new Map(
        body.items.map((item) => [item.partId, decodeEntityVersion(item.stockEntityVersion)]),
      );
      try {
        const result = await idempotentInventoryMutation({
          services,
          userId: authenticated.userId,
          publicCompanyId: params.companyId,
          operation: "inventory.pick",
          key: headers["idempotency-key"],
          request: { params, body },
          responseStatus: 200,
          responseSchema: InventoryPickResultSchema,
          work: (transaction, internalCompanyId) => pickInventoryStock(transaction, {
            internalCompanyId,
            request: body,
            expectedVersions,
            pickedAt: new Date(),
          }),
        });
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapInventoryMutationDatabaseError(error);
      }
    },
  );
}
