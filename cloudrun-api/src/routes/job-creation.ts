import {
  ApiFailureResponseSchema,
  JobCreateRequestSchema,
  JobCreateResultSchema,
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
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  readCompletedIdempotencyKey,
} from "../idempotency/repository.js";
import { createJobWithDetails } from "../jobs/creation-repository.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { readPendingUploadSession } from "../uploads/repository.js";

const creationParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const creationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const creationResponseSchema = createApiSuccessResponseSchema(JobCreateResultSchema);

export interface JobCreationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly storage?: CompanyFileStorage;
  readonly supabaseUsers: SupabaseUserClient;
}

export function registerJobCreationRoutes(
  app: FastifyInstance,
  services: JobCreationRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/jobs",
    {
      schema: {
        tags: ["jobs"],
        summary: "Create a job atomically",
        params: creationParamsSchema,
        headers: creationHeadersSchema,
        body: JobCreateRequestSchema,
        response: {
          201: creationResponseSchema,
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
      const params = creationParamsSchema.parse(request.params);
      const headers = creationHeadersSchema.parse(request.headers);
      const body = JobCreateRequestSchema.parse(request.body);
      if (body.uploadSessionId && body.status !== "finished") {
        throw new AppError({
          statusCode: 400,
          code: "UPLOAD_SESSION_PURPOSE_INVALID",
          message: "Attachments can be finalized only with a finished job.",
        });
      }
      const idempotencyRequest = { params, body };

      let preflight;
      try {
        preflight = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              params.companyId,
            );
            const replay = await readCompletedIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: "job.create",
              key: headers["idempotency-key"],
              request: idempotencyRequest,
            });
            const upload = !replay && body.uploadSessionId
              ? await readPendingUploadSession(transaction, {
                  sessionId: body.uploadSessionId,
                  internalCompanyId: tenant.internalCompanyId,
                  userId: authenticated.userId,
                  purpose: "job.create_finished",
                  targetJobId: null,
                })
              : null;
            return { tenant, replay, upload };
          },
        );
      } catch (error) {
        throw mapDatabaseError(error, "job.create");
      }

      if (preflight.replay) {
        reply.code(201);
        return apiSuccess(
          request.id,
          JobCreateResultSchema.parse(preflight.replay.responseBody),
        );
      }
      if (preflight.upload) {
        if (!services.storage) {
          throw new AppError({
            statusCode: 503,
            code: "STORAGE_NOT_CONFIGURED",
            message: "Attachment storage is temporarily unavailable.",
            retryable: true,
          });
        }
        await services.storage.verifyUploadedAttachments(preflight.upload.attachments);
      }

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
              operation: "job.create",
              key: headers["idempotency-key"],
              request: idempotencyRequest,
            });
            if (claim.replayed) {
              return JobCreateResultSchema.parse(claim.responseBody);
            }
            const result = await createJobWithDetails(transaction, {
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
        throw mapDatabaseError(error, "job.create");
      }
    },
  );
}
