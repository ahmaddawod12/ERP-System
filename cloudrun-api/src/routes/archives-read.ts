import {
  ApiFailureResponseSchema,
  ArchiveListPageSchema,
  ArchiveListQuerySchema,
  ArchiveContentQuerySchema,
  ArchiveContentResponseSchema,
  ArchiveRunDownloadSchema,
  createApiSuccessResponseSchema,
  type ArchiveDataType,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { mapDatabaseError } from "../database/errors.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import { resolveTenantContext } from "../tenancy/context.js";
import {
  readArchiveDownloadRecord,
  readArchivesPage,
} from "../archives/read-repository.js";
import type { ArchiveStorage } from "../archives/archive-storage.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const archiveRunParamsSchema = companyParamsSchema.extend({
  archiveRunId: z.uuid(),
}).strict();

const archiveListResponseSchema = createApiSuccessResponseSchema(ArchiveListPageSchema);
const archiveDownloadResponseSchema = createApiSuccessResponseSchema(ArchiveRunDownloadSchema);

export interface ArchiveReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly archiveStorage?: ArchiveStorage;
}

interface ArchiveViewerScope {
  readonly role: string;
  readonly accountType: string;
  readonly memberNo: number | null;
  readonly enabledModules: readonly string[];
}

function requireArchiveStorage(storage: ArchiveStorage | undefined): ArchiveStorage {
  if (!storage) {
    throw new AppError({
      statusCode: 503,
      code: "ARCHIVE_STORAGE_UNAVAILABLE",
      message: "Archive downloads are temporarily unavailable.",
      retryable: true,
    });
  }
  return storage;
}

function assertArchiveTypeAccess(
  workspace: ArchiveViewerScope,
  dataType: ArchiveDataType,
): void {
  const requiredModule = dataType === "jobs" ? "solojob" : "documents";
  if (!workspace.enabledModules.includes(requiredModule)) {
    throw new AppError({
      statusCode: 403,
      code: "ARCHIVE_MODULE_DISABLED",
      message: "This archive type is not enabled for the current workspace.",
    });
  }
  if (
    (workspace.role === "worker" && dataType !== "jobs")
    || (workspace.role === "basic" && dataType !== "documents")
  ) {
    throw new AppError({
      statusCode: 403,
      code: "ARCHIVE_ACCESS_FORBIDDEN",
      message: "This archive type is not available for the current workspace role.",
    });
  }
}

function scopedArchiveDataType(
  workspace: ArchiveViewerScope,
  requested: ArchiveDataType | undefined,
): ArchiveDataType | undefined {
  if (requested !== undefined) {
    assertArchiveTypeAccess(workspace, requested);
    return requested;
  }
  if (workspace.role === "worker") {
    assertArchiveTypeAccess(workspace, "jobs");
    return "jobs";
  }
  if (workspace.role === "basic") {
    assertArchiveTypeAccess(workspace, "documents");
    return "documents";
  }

  const allowedTypes = (["jobs", "documents"] as const).filter((dataType) => {
    const moduleName = dataType === "jobs" ? "solojob" : "documents";
    return workspace.enabledModules.includes(moduleName);
  });
  if (allowedTypes.length === 1) return allowedTypes[0];
  if (allowedTypes.length === 0) {
    throw new AppError({
      statusCode: 403,
      code: "ARCHIVE_MODULE_DISABLED",
      message: "Archive access is not enabled for the current workspace.",
    });
  }
  return undefined;
}

function filterArchiveItems(
  workspace: ArchiveViewerScope,
  dataType: ArchiveDataType,
  items: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
  assertArchiveTypeAccess(workspace, dataType);
  if (
    dataType === "documents"
    || workspace.role === "manager"
    || workspace.role === "dev"
    || (workspace.role === "user" && workspace.accountType === "solo")
  ) {
    return items;
  }
  if (workspace.memberNo === null) return [];
  const memberNo = String(workspace.memberNo);
  return items.filter((item) => String(item.wid ?? "") === memberNo);
}

export function registerArchiveReadRoutes(
  app: FastifyInstance,
  services: ArchiveReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/archives",
    {
      schema: {
        tags: ["archives"],
        summary: "List monthly archive runs for the company",
        params: companyParamsSchema,
        querystring: ArchiveListQuerySchema,
        response: {
          200: archiveListResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const auth = await services.authenticator.authenticate(request);
      const params = companyParamsSchema.parse(request.params);
      const query = ArchiveListQuerySchema.parse(request.query);
      const cursor = query.afterCursor ?? query.cursor;

      const page = await services.database.withTransaction(
        { userId: auth.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(transaction, auth.userId, params.companyId);
          const dataType = scopedArchiveDataType(tenant.workspace, query.dataType);
          return readArchivesPage(transaction, {
            internalCompanyId: tenant.internalCompanyId,
            ...(dataType === undefined ? {} : { dataType }),
            ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
            ...(cursor === undefined ? {} : { cursor }),
          });
        },
      ).catch((error: unknown) => {
        throw mapDatabaseError(error);
      });

      const result = ArchiveListPageSchema.parse(page);
      return apiSuccess(request.id, result, result.nextCursor);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/archives/:archiveRunId/download",
    {
      schema: {
        tags: ["archives"],
        summary: "Download an exact authorized archive run",
        params: archiveRunParamsSchema,
        response: {
          200: archiveDownloadResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const auth = await services.authenticator.authenticate(request);
      const params = archiveRunParamsSchema.parse(request.params);
      const result = await services.database.withTransaction(
        { userId: auth.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            auth.userId,
            params.companyId,
          );
          const record = await readArchiveDownloadRecord(
            transaction,
            tenant.internalCompanyId,
            params.archiveRunId,
          );
          assertArchiveTypeAccess(tenant.workspace, record.dataType);
          return { record, workspace: tenant.workspace };
        },
      ).catch((error: unknown) => {
        throw mapDatabaseError(error);
      });

      const storage = requireArchiveStorage(services.archiveStorage);
      const content = await storage.readArchiveJsonByPath(
        String(params.companyId),
        result.record.objectPath,
      );
      if (content === null) {
        throw new AppError({
          statusCode: 404,
          code: "ARCHIVE_FILE_NOT_FOUND",
          message: "The archive file was not found.",
        });
      }
      return apiSuccess(request.id, ArchiveRunDownloadSchema.parse({
        archiveRunId: result.record.archiveRunId,
        archiveKey: result.record.archiveKey,
        dataType: result.record.dataType,
        checksum: result.record.checksum,
        items: filterArchiveItems(
          result.workspace,
          result.record.dataType,
          content.items,
        ),
      }));
    },
  );

  if (services.archiveStorage !== undefined) {
    const archiveStorage = services.archiveStorage;
    const archiveContentResponseSchema = createApiSuccessResponseSchema(
      ArchiveContentResponseSchema,
    );

    app.get(
      "/api/v1/companies/:companyId/archives/content",
      {
        schema: {
          tags: ["archives"],
          summary: "Fetch archived month content from Cloud Storage",
          params: companyParamsSchema,
          querystring: ArchiveContentQuerySchema,
          response: {
            200: archiveContentResponseSchema,
            400: ApiFailureResponseSchema,
            401: ApiFailureResponseSchema,
            403: ApiFailureResponseSchema,
            404: ApiFailureResponseSchema,
            503: ApiFailureResponseSchema,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const auth = await services.authenticator.authenticate(request);
        const params = companyParamsSchema.parse(request.params);
        const query = ArchiveContentQuerySchema.parse(request.query);

        const workspace = await services.database.withTransaction(
          { userId: auth.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, auth.userId, params.companyId);
            const dataType: ArchiveDataType = query.dataType === "finishedJobs"
              ? "jobs"
              : "documents";
            assertArchiveTypeAccess(tenant.workspace, dataType);
            return tenant.workspace;
          },
        ).catch((error: unknown) => {
          throw mapDatabaseError(error);
        });

        const suffix = query.dataType === "finishedJobs" ? "j" : "d";
        const archiveKey = `${query.year}-${query.month}-${suffix}`;
        const content = await archiveStorage.readArchiveJson(String(params.companyId), archiveKey);
        if (content === null) {
          throw new AppError({
            statusCode: 404,
            code: "ARCHIVE_NOT_FOUND",
            message: "No archive found for the requested month.",
            retryable: false,
          });
        }

        const result = ArchiveContentResponseSchema.parse({
          year: query.year,
          month: query.month,
          dataType: query.dataType,
          items: filterArchiveItems(
            workspace,
            query.dataType === "finishedJobs" ? "jobs" : "documents",
            content.items,
          ),
        });
        return apiSuccess(request.id, result);
      },
    );
  }
}
