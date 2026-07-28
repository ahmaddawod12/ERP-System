import {
  ApiFailureResponseSchema,
  JobAttachmentDownloadAccessSchema,
  JobDetailSchema,
  JobListPageSchema,
  JobListQuerySchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  readJobAttachmentFile,
  readJobDetail,
  readJobsPage,
} from "../jobs/read-repository.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { resolveTenantContext } from "../tenancy/context.js";

const jobsParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const jobParamsSchema = jobsParamsSchema.extend({
  jobId: z.uuid(),
}).strict();

const jobAttachmentParamsSchema = jobParamsSchema.extend({
  attachmentId: z.uuid(),
}).strict();

const jobsResponseSchema = createApiSuccessResponseSchema(JobListPageSchema);
const jobDetailResponseSchema = createApiSuccessResponseSchema(JobDetailSchema);
const jobAttachmentDownloadResponseSchema = createApiSuccessResponseSchema(
  JobAttachmentDownloadAccessSchema,
);
const SIGNED_ATTACHMENT_TTL_SECONDS = 15 * 60;

export interface JobsReadRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly storage?: CompanyFileStorage;
}

function requireDownloadSigner(storage: CompanyFileStorage | undefined) {
  if (!storage?.createSignedDownloadUrl) {
    throw new AppError({
      statusCode: 503,
      code: "STORAGE_UNAVAILABLE",
      message: "Job attachment access is temporarily unavailable.",
      retryable: true,
    });
  }
  return storage.createSignedDownloadUrl.bind(storage);
}

function assertCompanyObjectPath(internalCompanyId: string, objectPath: string): void {
  const expectedPrefix = `${internalCompanyId}/`;
  const segments = objectPath.slice(expectedPrefix.length).split("/");
  if (
    !objectPath.startsWith(expectedPrefix)
    || objectPath.length > 1_024
    || segments.some((segment) => (
      !segment
      || segment === "."
      || segment === ".."
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(segment)
    ))
  ) {
    throw new AppError({
      statusCode: 409,
      code: "JOB_ATTACHMENT_FILE_INVALID",
      message: "The job attachment file is unavailable.",
    });
  }
}

export function registerJobsReadRoutes(
  app: FastifyInstance,
  services: JobsReadRouteServices,
): void {
  app.get(
    "/api/v1/companies/:companyId/jobs",
    {
      schema: {
        tags: ["jobs"],
        summary: "List authorized company jobs with stable cursor pagination",
        params: jobsParamsSchema,
        querystring: JobListQuerySchema,
        response: {
          200: jobsResponseSchema,
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
      const authenticated = await services.authenticator.authenticate(request);
      const params = jobsParamsSchema.parse(request.params);
      const query = JobListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readJobsPage(transaction, tenant.internalCompanyId, query);
        },
      );

      return apiSuccess(request.id, page, page.nextCursor);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/jobs/:jobId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Read an authorized job with parts and attachment metadata",
        params: jobParamsSchema,
        response: {
          200: jobDetailResponseSchema,
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
      const authenticated = await services.authenticator.authenticate(request);
      const params = jobParamsSchema.parse(request.params);
      const detail = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          return readJobDetail(transaction, tenant.internalCompanyId, params.jobId);
        },
      );
      return apiSuccess(request.id, detail);
    },
  );

  app.get(
    "/api/v1/companies/:companyId/jobs/:jobId/attachments/:attachmentId/download",
    {
      schema: {
        tags: ["jobs"],
        summary: "Create a short-lived URL for an exact authorized job attachment",
        params: jobAttachmentParamsSchema,
        response: {
          200: jobAttachmentDownloadResponseSchema,
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
      const authenticated = await services.authenticator.authenticate(request);
      const params = jobAttachmentParamsSchema.parse(request.params);
      const result = await services.database.withTransaction(
        { userId: authenticated.userId },
        async (transaction) => {
          const tenant = await resolveTenantContext(
            transaction,
            authenticated.userId,
            params.companyId,
          );
          const file = await readJobAttachmentFile(
            transaction,
            tenant.internalCompanyId,
            params.jobId,
            params.attachmentId,
          );
          return { file, internalCompanyId: tenant.internalCompanyId };
        },
      );
      assertCompanyObjectPath(result.internalCompanyId, result.file.objectPath);
      const sign = requireDownloadSigner(services.storage);
      const downloadURL = await sign(
        result.file.objectPath,
        SIGNED_ATTACHMENT_TTL_SECONDS,
      );
      return apiSuccess(request.id, JobAttachmentDownloadAccessSchema.parse({
        jobId: result.file.jobId,
        attachmentId: result.file.attachmentId,
        kind: result.file.kind,
        downloadURL,
        expiresAt: new Date(
          Date.now() + SIGNED_ATTACHMENT_TTL_SECONDS * 1_000,
        ).toISOString(),
      }));
    },
  );
}
