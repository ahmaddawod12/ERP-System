import {
  ApiFailureResponseSchema,
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  DocumentGenerateRequestSchema,
  DocumentPreviewRequestSchema,
  DocumentTaskAcceptedSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type SupabaseUserClient,
} from "../auth/index.js";
import { mapDatabaseError } from "../database/errors.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { dispatchPendingDocumentTasks, type DocumentTaskPublisher } from "../documents/dispatch.js";
import {
  createDocumentGenerationTask,
  createDocumentPreviewTask,
  deleteDocument,
} from "../documents/mutation-repository.js";
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import { claimIdempotencyKey, completeIdempotencyClaim } from "../idempotency/repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const documentParamsSchema = companyParamsSchema.extend({ documentId: z.uuid() }).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const acceptedResponseSchema = createApiSuccessResponseSchema(DocumentTaskAcceptedSchema);
const deleteResponseSchema = createApiSuccessResponseSchema(DocumentDeleteResultSchema);

export interface DocumentMutationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
  readonly documentTaskPublisher?: DocumentTaskPublisher;
}

function mapDocumentMutationDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "40001" && message.includes("DOCUMENT_ENTITY_VERSION_CONFLICT")) {
    return new AppError({
      statusCode: 409,
      code: "STALE_ENTITY_VERSION",
      message: "The document changed before this request was applied.",
      fieldErrors: { entityVersion: ["Reload the document and try again."] },
      cause: error,
    });
  }
  if (code === "P0002") {
    const clientMissing = message.includes("DOCUMENT_CLIENT_NOT_FOUND");
    const partMissing = message.includes("DOCUMENT_PART_NOT_FOUND");
    return new AppError({
      statusCode: 404,
      code: clientMissing ? "DOCUMENT_CLIENT_NOT_FOUND" : partMissing ? "DOCUMENT_PART_NOT_FOUND" : "DOCUMENT_NOT_FOUND",
      message: clientMissing
        ? "The selected client is not available in this workspace."
        : partMissing
          ? "A selected inventory part is not available in this workspace."
          : "The requested document was not found.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("DOCUMENTS_MODULE_DISABLED")) {
    return new AppError({
      statusCode: 403,
      code: "DOCUMENTS_MODULE_DISABLED",
      message: "Documents are not enabled for this workspace.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "DOCUMENT_MUTATION_FORBIDDEN",
      message: "You are not allowed to change documents in this workspace.",
      cause: error,
    });
  }
  if (code === "22023") {
    return new AppError({
      statusCode: 400,
      code: message.includes("TAX_WORKFLOW_REQUIRED") ? "TAX_WORKFLOW_REQUIRED" : "INVALID_DOCUMENT",
      message: message.includes("TAX_WORKFLOW_REQUIRED")
        ? "Tax invoices must use the tax approval workflow."
        : "The document contains invalid fields.",
      cause: error,
    });
  }
  if (code === "23514" || code === "55000") {
    const approved = message.includes("APPROVED_TAX_DOCUMENT_IMMUTABLE");
    const activeTask = message.includes("DOCUMENT_TASK_ACTIVE");
    return new AppError({
      statusCode: 409,
      code: approved
        ? "APPROVED_TAX_DOCUMENT_IMMUTABLE"
        : activeTask
          ? "DOCUMENT_TASK_ACTIVE"
          : "GENERATED_DOCUMENT_DELETE_REQUIRES_CLEANUP",
      message: approved
        ? "Approved tax invoices cannot be deleted."
        : activeTask
          ? "The document cannot be deleted while PDF generation is active."
          : "Generated document files must be removed by the cleanup workflow.",
      cause: error,
    });
  }
  if (code === "23505") {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_CONFLICT",
      message: "The document conflicts with another concurrent change.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

async function bestEffortDispatch(
  request: FastifyRequest,
  services: DocumentMutationRouteServices,
  userId: string,
  taskId: string,
): Promise<void> {
  if (services.documentTaskPublisher === undefined) return;
  try {
    await dispatchPendingDocumentTasks(services.database, services.documentTaskPublisher, {
      userId,
      taskKey: taskId,
      limit: 1,
    });
  } catch (error) {
    request.log.warn({ err: error, taskId }, "document task remains pending after dispatch attempt");
  }
}

export function registerDocumentMutationRoutes(
  app: FastifyInstance,
  services: DocumentMutationRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/document-tasks/preview",
    {
      schema: {
        tags: ["document-tasks"],
        summary: "Create a private PDF preview task",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: DocumentPreviewRequestSchema,
        response: {
          202: acceptedResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = DocumentPreviewRequestSchema.parse(request.body);
      try {
        const accepted = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, authenticated.userId, params.companyId);
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "document.preview",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return DocumentTaskAcceptedSchema.parse(claim.responseBody);
            const result = await createDocumentPreviewTask(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
              createdAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 202, result);
            return result;
          },
        );
        await bestEffortDispatch(request, services, authenticated.userId, accepted.taskId);
        reply.code(202);
        return apiSuccess(request.id, accepted);
      } catch (error) {
        throw mapDocumentMutationDatabaseError(error);
      }
    },
  );

  app.post(
    "/api/v1/companies/:companyId/document-tasks/generate",
    {
      schema: {
        tags: ["document-tasks"],
        summary: "Atomically create a non-tax document and PDF generation task",
        params: companyParamsSchema,
        headers: mutationHeadersSchema,
        body: DocumentGenerateRequestSchema,
        response: {
          202: acceptedResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = companyParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = DocumentGenerateRequestSchema.parse(request.body);
      try {
        const accepted = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, authenticated.userId, params.companyId);
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "document.generate",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return DocumentTaskAcceptedSchema.parse(claim.responseBody);
            const result = await createDocumentGenerationTask(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
              createdAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 202, result);
            return result;
          },
        );
        await bestEffortDispatch(request, services, authenticated.userId, accepted.taskId);
        reply.code(202);
        return apiSuccess(request.id, accepted);
      } catch (error) {
        throw mapDocumentMutationDatabaseError(error);
      }
    },
  );

  app.delete(
    "/api/v1/companies/:companyId/documents/:documentId",
    {
      schema: {
        tags: ["documents"],
        summary: "Delete an ungenerated document with optimistic concurrency",
        params: documentParamsSchema,
        headers: mutationHeadersSchema,
        body: DocumentDeleteRequestSchema,
        response: {
          200: deleteResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = documentParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = DocumentDeleteRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);
      try {
        const removed = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, authenticated.userId, params.companyId);
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "document.delete",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return DocumentDeleteResultSchema.parse(claim.responseBody);
            const result = await deleteDocument(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              documentId: params.documentId,
              expectedEntityVersion,
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, removed);
      } catch (error) {
        throw mapDocumentMutationDatabaseError(error);
      }
    },
  );
}
