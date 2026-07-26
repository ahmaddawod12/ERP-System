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
  return items.filter((item) => {
    const assignee = item.assignee;
    const canonicalMemberNo = assignee !== null
      && typeof assignee === "object"
      && !Array.isArray(assignee)
      ? (assignee as Record<string, unknown>).memberNo
      : undefined;
    return String(canonicalMemberNo ?? item.wid ?? "") === memberNo;
  });
}

async function readVerifiedArchive(
  storage: ArchiveStorage,
  companyStorageId: string,
  record: Awaited<ReturnType<typeof readArchiveDownloadRecord>>,
) {
  const content = await storage.readVerifiedArchiveJsonByPath(
    companyStorageId,
    record.objectPath,
    record.storageGeneration,
    record.checksum,
  );
  if (content === null) {
    throw new AppError({
      statusCode: 503,
      code: "ARCHIVE_OBJECT_UNAVAILABLE",
      message: "The exact archived object is temporarily unavailable.",
      retryable: true,
    });
  }
  return content;
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
            ...(query.year === undefined ? {} : { year: query.year }),
            ...(query.month === undefined ? {} : { month: query.month }),
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
      let content;
      try {
        content = await readVerifiedArchive(
          storage,
          String(params.companyId),
          result.record,
        );
      } catch (error) {
        if (error instanceof AppError && error.code === "ARCHIVE_INTEGRITY_FAILURE") {
          request.log.error({
            archiveIntegrityFailure: true,
            archiveRunId: result.record.archiveRunId,
            dataType: result.record.dataType,
            storageGeneration: result.record.storageGeneration,
          }, "archive integrity verification failed");
        }
        throw error;
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
            409: ApiFailureResponseSchema,
            503: ApiFailureResponseSchema,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const auth = await services.authenticator.authenticate(request);
        const params = companyParamsSchema.parse(request.params);
        const query = ArchiveContentQuerySchema.parse(request.query);

        const period = await services.database.withTransaction(
          { userId: auth.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, auth.userId, params.companyId);
            const dataType: ArchiveDataType = query.dataType === "finishedJobs"
              ? "jobs"
              : "documents";
            assertArchiveTypeAccess(tenant.workspace, dataType);
            const summaries = [];
            let cursor: string | undefined;
            do {
              const page = await readArchivesPage(transaction, {
                internalCompanyId: tenant.internalCompanyId,
                dataType,
                year: query.year,
                month: query.month,
                pageSize: 200,
                ...(cursor === undefined ? {} : { cursor }),
              });
              summaries.push(...page.items);
              cursor = page.nextCursor ?? undefined;
            } while (cursor !== undefined);
            const readySummaries = summaries
              .filter((run) => (
                run.status === "uploaded_not_deleted" || run.status === "deleted"
              ))
              .sort((left, right) => left.segment - right.segment);
            const records = [];
            for (const summary of readySummaries) {
              records.push(await readArchiveDownloadRecord(
                transaction,
                tenant.internalCompanyId,
                summary.archiveRunId,
              ));
            }
            return {
              workspace: tenant.workspace,
              records,
              hadRuns: summaries.length > 0,
            };
          },
        ).catch((error: unknown) => {
          throw mapDatabaseError(error);
        });

        if (period.records.length === 0 && period.hadRuns) {
          throw new AppError({
            statusCode: 409,
            code: "ARCHIVE_NOT_READY",
            message: "The requested archive period is not ready.",
          });
        }
        if (period.records.length === 0) {
          throw new AppError({
            statusCode: 404,
            code: "ARCHIVE_NOT_FOUND",
            message: "No archive found for the requested month.",
            retryable: false,
          });
        }
        const items: Record<string, unknown>[] = [];
        for (const record of period.records) {
          const content = await readVerifiedArchive(
            archiveStorage,
            String(params.companyId),
            record,
          );
          items.push(...content.items);
        }

        const result = ArchiveContentResponseSchema.parse({
          year: query.year,
          month: query.month,
          dataType: query.dataType,
          items: filterArchiveItems(
            period.workspace,
            query.dataType === "finishedJobs" ? "jobs" : "documents",
            items,
          ),
        });
        reply.header("deprecation", "true");
        reply.header("sunset", "Sun, 31 Jan 2027 23:59:59 GMT");
        reply.header(
          "link",
          `</api/v1/companies/${params.companyId}/archives?dataType=${
            query.dataType === "finishedJobs" ? "jobs" : "documents"
          }&year=${query.year}&month=${query.month}>; rel="successor-version"`,
        );
        request.log.info({
          legacyArchiveContent: true,
          dataType: query.dataType,
          segmentCount: period.records.length,
        }, "legacy archive content endpoint used");
        return apiSuccess(request.id, result);
      },
    );
  }
}
