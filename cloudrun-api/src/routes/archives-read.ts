import {
  ApiFailureResponseSchema,
  ArchiveContentQuerySchema,
  ArchiveContentResponseSchema,
  CursorSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { mapDatabaseError } from "../database/errors.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { readArchivesPage, type ArchiveListPage } from "../archives/read-repository.js";
import type { ArchiveStorage } from "../archives/archive-storage.js";

const companyParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const archiveListQuerySchema = z.object({
  dataType: z.enum(["jobs", "documents"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(2_000).optional(),
}).strict();

const archiveSummarySchema = z.object({
  archiveKey: z.string().min(1).max(32),
  dataType: z.string().min(1).max(32),
  status: z.enum(["pending", "uploaded_not_deleted", "deleted", "failed"]),
  docCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  storagePath: z.string().nullable(),
  checksum: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

const archiveListPageSchema = z.object({
  items: z.array(archiveSummarySchema),
  nextCursor: z.union([CursorSchema, z.null()]),
}).strict();
const archiveListResponseSchema = z.object({
  ok: z.literal(true),
  data: archiveListPageSchema,
  meta: z.object({ requestId: z.string(), nextCursor: z.union([CursorSchema, z.null()]).optional() }).loose(),
}).strict();

export interface ArchiveReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly archiveStorage?: ArchiveStorage;
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
        querystring: archiveListQuerySchema,
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
      const query = archiveListQuerySchema.parse(request.query);

      const page = await services.database.withTransaction(
        { userId: auth.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(transaction, auth.userId, params.companyId);
          return readArchivesPage(transaction, {
            internalCompanyId: tenant.internalCompanyId,
            ...(query.dataType === undefined ? {} : { dataType: query.dataType }),
            ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          });
        },
      ).catch((error: unknown) => {
        throw mapDatabaseError(error);
      });

      const result: ArchiveListPage = archiveListPageSchema.parse(page);
      return apiSuccess(request.id, result, result.nextCursor);
    },
  );

  if (services.archiveStorage !== undefined) {
    const archiveStorage = services.archiveStorage;
    const archiveContentResponseSchema = z.object({
      ok: z.literal(true),
      data: ArchiveContentResponseSchema,
      meta: z.object({ requestId: z.string() }).loose(),
    }).strict();

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

        const internalCompanyId = await services.database.withTransaction(
          { userId: auth.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(transaction, auth.userId, params.companyId);
            return tenant.internalCompanyId;
          },
        ).catch((error: unknown) => {
          throw mapDatabaseError(error);
        });

        const suffix = query.dataType === "finishedJobs" ? "j" : "d";
        const archiveKey = `${query.year}-${query.month}-${suffix}`;
        const content = await archiveStorage.readArchiveJson(internalCompanyId, archiveKey);
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
          items: content.items,
        });
        return apiSuccess(request.id, result);
      },
    );
  }
}
