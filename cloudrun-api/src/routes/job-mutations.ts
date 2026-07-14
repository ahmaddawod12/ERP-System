import {
  ApiFailureResponseSchema,
  JobAcceptRequestSchema,
  JobAcceptResultSchema,
  JobDeleteRequestSchema,
  JobDeleteResultSchema,
  JobUpdateRequestSchema,
  JobUpdateResultSchema,
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
import { decodeEntityVersion } from "../entities/version.js";
import { apiSuccess } from "../http/envelope.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
} from "../idempotency/repository.js";
import {
  acceptJob,
  deleteJob,
  updateJob,
} from "../jobs/mutation-repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const jobParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jobId: z.uuid(),
}).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const jobUpdateResponseSchema = createApiSuccessResponseSchema(JobUpdateResultSchema);
const jobAcceptResponseSchema = createApiSuccessResponseSchema(JobAcceptResultSchema);
const jobDeleteResponseSchema = createApiSuccessResponseSchema(JobDeleteResultSchema);
const mutationResponses = {
  400: ApiFailureResponseSchema,
  401: ApiFailureResponseSchema,
  403: ApiFailureResponseSchema,
  404: ApiFailureResponseSchema,
  409: ApiFailureResponseSchema,
  425: ApiFailureResponseSchema,
  503: ApiFailureResponseSchema,
} as const;

export interface JobMutationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
}

export function registerJobMutationRoutes(
  app: FastifyInstance,
  services: JobMutationRouteServices,
): void {
  app.patch(
    "/api/v1/companies/:companyId/jobs/:jobId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Update job metadata, client, assignee, or non-finished state",
        params: jobParamsSchema,
        headers: mutationHeadersSchema,
        body: JobUpdateRequestSchema,
        response: { 200: jobUpdateResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = jobParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = JobUpdateRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const result = await services.database.withTransaction(
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
              operation: "job.update",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return JobUpdateResultSchema.parse(claim.responseBody);

            const updated = await updateJob(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              jobId: params.jobId,
              expectedEntityVersion,
              request: body,
              updatedAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, updated);
            return updated;
          },
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapDatabaseError(error, "job.update");
      }
    },
  );

  app.post(
    "/api/v1/companies/:companyId/jobs/:jobId/accept",
    {
      schema: {
        tags: ["jobs"],
        summary: "Accept a pending or waiting job as finished",
        params: jobParamsSchema,
        headers: mutationHeadersSchema,
        body: JobAcceptRequestSchema,
        response: { 200: jobAcceptResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = jobParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = JobAcceptRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const result = await services.database.withTransaction(
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
              operation: "job.accept",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return JobAcceptResultSchema.parse(claim.responseBody);

            const accepted = await acceptJob(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              jobId: params.jobId,
              expectedEntityVersion,
              acceptedAt: new Date(),
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, accepted);
            return accepted;
          },
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapDatabaseError(error, "job.accept");
      }
    },
  );

  app.delete(
    "/api/v1/companies/:companyId/jobs/:jobId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Delete an unreferenced job with optimistic concurrency",
        params: jobParamsSchema,
        headers: mutationHeadersSchema,
        body: JobDeleteRequestSchema,
        response: { 200: jobDeleteResponseSchema, ...mutationResponses },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = jobParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = JobDeleteRequestSchema.parse(request.body);
      const expectedEntityVersion = decodeEntityVersion(body.entityVersion);

      try {
        const result = await services.database.withTransaction(
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
              operation: "job.delete",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return JobDeleteResultSchema.parse(claim.responseBody);

            const deleted = await deleteJob(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              jobId: params.jobId,
              expectedEntityVersion,
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, deleted);
            return deleted;
          },
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapDatabaseError(error, "job.delete");
      }
    },
  );
}
