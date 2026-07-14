import {
  ApiFailureResponseSchema,
  JobCompletionRequestSchema,
  JobCompletionResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type SupabaseUserClient,
} from "../auth/index.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { mapDatabaseError } from "../database/errors.js";
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  readCompletedIdempotencyKey,
} from "../idempotency/repository.js";
import { completeJobWithDetails } from "../jobs/completion-repository.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { readPendingUploadSession } from "../uploads/repository.js";

const completionParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jobId: z.uuid(),
}).strict();
const completionHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const completionResponseSchema = createApiSuccessResponseSchema(JobCompletionResultSchema);

export interface JobCompletionRouteServices {
  readonly database: ApiDatabaseRuntime;
  readonly authenticator: ApiRequestAuthenticator;
  readonly storage?: CompanyFileStorage;
  readonly supabaseUsers: SupabaseUserClient;
}

export function registerJobCompletionRoutes(
  app: FastifyInstance,
  services: JobCompletionRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/jobs/:jobId/complete",
    {
      schema: {
        tags: ["jobs"],
        summary: "Complete an assigned job atomically",
        params: completionParamsSchema,
        headers: completionHeadersSchema,
        body: JobCompletionRequestSchema,
        response: {
          200: completionResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          425: ApiFailureResponseSchema,
          501: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = completionParamsSchema.parse(request.params);
      const headers = completionHeadersSchema.parse(request.headers);
      const body = JobCompletionRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);
      const details = {
        ...(body.timeFrom === undefined ? {} : { timeFrom: body.timeFrom }),
        ...(body.timeTo === undefined ? {} : { timeTo: body.timeTo }),
        ...(body.signingPerson === undefined ? {} : { signingPerson: body.signingPerson }),
        ...(body.travelDistance === undefined ? {} : { travelDistance: body.travelDistance }),
      };
      const idempotencyRequest = { params, body };

      const uploadSessionId = body.uploadSessionId ?? null;
      if (uploadSessionId) {
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
                operation: "job.complete_assigned",
                key: headers["idempotency-key"],
                request: idempotencyRequest,
              });
              const upload = replay
                ? null
                : await readPendingUploadSession(transaction, {
                    sessionId: uploadSessionId,
                    internalCompanyId: tenant.internalCompanyId,
                    userId: authenticated.userId,
                    purpose: "job.complete_assigned",
                    targetJobId: params.jobId,
                  });
              return { replay, upload };
            },
          );
        } catch (error) {
          throw mapDatabaseError(error, "job.complete");
        }
        if (preflight.replay) {
          return apiSuccess(
            request.id,
            JobCompletionResultSchema.parse(preflight.replay.responseBody),
          );
        }
        if (!services.storage) {
          throw new AppError({
            statusCode: 503,
            code: "STORAGE_NOT_CONFIGURED",
            message: "Attachment storage is temporarily unavailable.",
            retryable: true,
          });
        }
        await services.storage.verifyUploadedAttachments(
          preflight.upload?.attachments ?? [],
        );
      }

      try {
        const completion = await services.database.withTransaction(
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
              operation: "job.complete_assigned",
              key: headers["idempotency-key"],
              request: idempotencyRequest,
            });
            if (claim.replayed) {
              return JobCompletionResultSchema.parse(claim.responseBody);
            }

            const result = await completeJobWithDetails(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              jobId: params.jobId,
              expectedEntityVersion,
              details,
              parts: body.partsUsed ?? null,
              uploadSessionId: body.uploadSessionId ?? null,
              completedAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, completion);
      } catch (error) {
        throw mapDatabaseError(error, "job.complete");
      }
    },
  );
}
