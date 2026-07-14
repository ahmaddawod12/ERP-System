import {
  ApiFailureResponseSchema,
  DocumentDownloadAccessSchema,
  DocumentListPageSchema,
  DocumentListQuerySchema,
  DocumentTaskSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import {
  readDocumentFile,
  readDocumentsPage,
  readDocumentTask,
} from "../documents/read-repository.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { resolveTenantContext } from "../tenancy/context.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const documentParamsSchema = companyParamsSchema.extend({
  documentId: z.uuid(),
}).strict();

const documentTaskParamsSchema = companyParamsSchema.extend({
  taskId: z.string().trim().min(1).max(160),
}).strict();

const documentsResponseSchema = createApiSuccessResponseSchema(DocumentListPageSchema);
const documentTaskResponseSchema = createApiSuccessResponseSchema(DocumentTaskSchema);
const downloadResponseSchema = createApiSuccessResponseSchema(DocumentDownloadAccessSchema);
const SIGNED_DOCUMENT_TTL_SECONDS = 15 * 60;
const SIGNED_TASK_TTL_SECONDS = 5 * 60;

export interface DocumentsReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly storage?: CompanyFileStorage;
}

function requireDownloadSigner(storage: CompanyFileStorage | undefined) {
  if (!storage?.createSignedDownloadUrl) {
    throw new AppError({
      statusCode: 503,
      code: "STORAGE_UNAVAILABLE",
      message: "Document file access is temporarily unavailable.",
      retryable: true,
    });
  }
  return storage.createSignedDownloadUrl.bind(storage);
}

function assertCompanyObjectPath(internalCompanyId: string, objectPath: string): void {
  if (!objectPath.startsWith(`${internalCompanyId}/`)) {
    throw new AppError({
      statusCode: 409,
      code: "DOCUMENT_FILE_INVALID",
      message: "The generated document file is unavailable.",
    });
  }
}

export function registerDocumentsReadRoutes(
  app: FastifyInstance,
  services: DocumentsReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/documents",
    {
      schema: {
        tags: ["documents"],
        summary: "List authorized documents with stable cursor pagination",
        params: companyParamsSchema,
        querystring: DocumentListQuerySchema,
        response: {
          200: documentsResponseSchema,
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
      const params = companyParamsSchema.parse(request.params);
      const query = DocumentListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readDocumentsPage(transaction, tenant.internalCompanyId, query);
        },
      );
      return apiSuccess(request.id, page, page.nextCursor);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/document-tasks/:taskId",
    {
      schema: {
        tags: ["document-tasks"],
        summary: "Read an owned or manager-visible PDF task",
        params: documentTaskParamsSchema,
        response: {
          200: documentTaskResponseSchema,
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
      const params = documentTaskParamsSchema.parse(request.params);
      const result = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          const record = await readDocumentTask(
            transaction,
            tenant.internalCompanyId,
            authenticated.userId,
            params.taskId,
          );
          return { record, internalCompanyId: tenant.internalCompanyId };
        },
      );

      let task = result.record.task;
      if (task.status === "completed" && result.record.objectPath) {
        assertCompanyObjectPath(result.internalCompanyId, result.record.objectPath);
        const sign = requireDownloadSigner(services.storage);
        const signedURL = await sign(result.record.objectPath, SIGNED_TASK_TTL_SECONDS);
        task = DocumentTaskSchema.parse({
          ...task,
          previewURL: task.taskType === "preview" ? signedURL : null,
          downloadURL: task.taskType === "generate" ? signedURL : null,
        });
      }
      return apiSuccess(request.id, task);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/documents/:documentId/download",
    {
      schema: {
        tags: ["documents"],
        summary: "Create a short-lived private document download URL",
        params: documentParamsSchema,
        response: {
          200: downloadResponseSchema,
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
      const params = documentParamsSchema.parse(request.params);
      const record = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readDocumentFile(transaction, tenant.internalCompanyId, params.documentId);
        },
      );
      const sign = requireDownloadSigner(services.storage);
      const downloadURL = await sign(record.objectPath, SIGNED_DOCUMENT_TTL_SECONDS);
      const expiresAt = new Date(Date.now() + SIGNED_DOCUMENT_TTL_SECONDS * 1_000).toISOString();
      return apiSuccess(request.id, DocumentDownloadAccessSchema.parse({
        documentId: record.documentId,
        documentCode: record.documentCode,
        downloadURL,
        expiresAt,
      }));
    },
  );
}
