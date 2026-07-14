import {
  ApiFailureResponseSchema,
  JobAttachmentPurposeSchema,
  JobAttachmentUploadSessionRequestSchema,
  JobAttachmentUploadSessionSchema,
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
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  type IdempotencyClaim,
} from "../idempotency/repository.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { resolveTenantContext } from "../tenancy/context.js";
import {
  prepareUploadSession,
  readPendingUploadSession,
  recordUploadSigningFailure,
  type PreparedUploadSession,
  type UploadSessionPreparation,
} from "../uploads/repository.js";

const uploadSessionResponseSchema = createApiSuccessResponseSchema(
  JobAttachmentUploadSessionSchema,
);
const uploadSessionHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const storedUploadSessionClaimSchema = z.object({
  uploadSessionId: z.uuid(),
  companyId: z.number().int().positive(),
  purpose: JobAttachmentPurposeSchema,
  jobId: z.uuid().nullable(),
}).strict();

const UPLOAD_SESSION_IDEMPOTENCY_OPERATION = "uploads.job_attachments.prepare";

type StoredUploadSessionClaim = z.infer<typeof storedUploadSessionClaimSchema>;

function canonicalClaim(
  session: PreparedUploadSession,
  companyId: number,
): StoredUploadSessionClaim {
  return {
    uploadSessionId: session.id,
    companyId,
    purpose: session.purpose,
    jobId: session.targetJobId,
  };
}

function parseReplayClaim(
  claim: IdempotencyClaim,
  requestBody: z.infer<typeof JobAttachmentUploadSessionRequestSchema>,
): StoredUploadSessionClaim {
  if (!claim.replayed || claim.responseStatus !== 201) {
    throw new Error("Upload-session idempotency replay is incomplete");
  }
  const stored = storedUploadSessionClaimSchema.parse(claim.responseBody);
  if (
    stored.uploadSessionId !== claim.id
    || stored.companyId !== requestBody.companyId
    || stored.purpose !== requestBody.purpose
    || stored.jobId !== (requestBody.jobId ?? null)
  ) {
    throw new Error("Upload-session idempotency replay does not match its claim");
  }
  return stored;
}

function preparationError(preparation: Exclude<
  UploadSessionPreparation,
  { readonly outcome: "ready" }
>): AppError {
  if (preparation.outcome === "rate_limited") {
    return new AppError({
      statusCode: 429,
      code: "UPLOAD_SESSION_RATE_LIMITED",
      message: `Too many upload sessions were requested. Try again after ${preparation.resetAt.toISOString()}.`,
      retryable: true,
    });
  }
  if (preparation.outcome === "quota_exceeded") {
    return new AppError({
      statusCode: 429,
      code: "UPLOAD_SESSION_QUOTA_EXCEEDED",
      message: "Finish or discard an existing upload session before creating another.",
      retryable: true,
    });
  }
  return new AppError({
    statusCode: 409,
    code: preparation.outcome === "expired"
      ? "UPLOAD_SESSION_EXPIRED"
      : "UPLOAD_SESSION_UNAVAILABLE",
    message: preparation.outcome === "expired"
      ? "The idempotent upload session has expired. Use a new idempotency key."
      : "The idempotent upload session can no longer be used. Use a new idempotency key.",
  });
}

function storageFailureCode(error: unknown): string {
  return error instanceof AppError
    ? error.code.slice(0, 500)
    : "signed_url_creation_failed";
}

export interface UploadSessionRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly storage: CompanyFileStorage;
  readonly storageBucketId: string;
  readonly supabaseUsers: SupabaseUserClient;
}

export function registerUploadSessionRoutes(
  app: FastifyInstance,
  services: UploadSessionRouteServices,
): void {
  app.post(
    "/api/v1/uploads/job-attachments/sessions",
    {
      schema: {
        tags: ["uploads"],
        summary: "Create object-specific signed job-attachment uploads",
        headers: uploadSessionHeadersSchema,
        body: JobAttachmentUploadSessionRequestSchema,
        response: {
          201: uploadSessionResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          425: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const headers = uploadSessionHeadersSchema.parse(request.headers);
      const body = JobAttachmentUploadSessionRequestSchema.parse(request.body);
      const idempotencyRequest = { body };

      let preflight;
      try {
        preflight = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = await resolveTenantContext(
              transaction,
              authenticated.userId,
              body.companyId,
            );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant.internalCompanyId,
              operation: UPLOAD_SESSION_IDEMPOTENCY_OPERATION,
              key: headers["idempotency-key"],
              request: idempotencyRequest,
            });
            if (claim.replayed) {
              const stored = parseReplayClaim(claim, body);
              const session = await readPendingUploadSession(transaction, {
                sessionId: stored.uploadSessionId,
                internalCompanyId: tenant.internalCompanyId,
                userId: authenticated.userId,
                purpose: stored.purpose,
                targetJobId: stored.jobId,
              });
              return { claim, preparation: null, session };
            }
            const preparation = await prepareUploadSession(transaction, {
              tenant,
              userId: authenticated.userId,
              sessionId: claim.id,
              request: body,
              bucketId: services.storageBucketId,
            });
            return {
              claim,
              preparation,
              session: preparation.outcome === "ready" ? preparation.session : null,
            };
          },
        );
      } catch (error) {
        throw mapDatabaseError(error);
      }
      if (preflight.preparation && preflight.preparation.outcome !== "ready") {
        // The SQL function returned instead of raising, so its limiter update is
        // committed before this application-level denial is emitted.
        throw preparationError(preflight.preparation);
      }
      if (!preflight.session) {
        throw new Error("Upload-session preparation did not return a session");
      }

      let attachments;
      try {
        attachments = await services.storage.createSignedUploadTargets(
          preflight.session.attachments,
        );
      } catch (error) {
        if (!preflight.claim.replayed) {
          await services.database.withTransaction(
            { userId: authenticated.userId },
            (transaction) => recordUploadSigningFailure(
              transaction,
              preflight.session!.id,
              storageFailureCode(error),
            ),
          ).catch(() => undefined);
        }
        throw error;
      }

      let finalized = preflight.session;
      if (!preflight.claim.replayed) {
        try {
          finalized = await services.database.withTransaction(
            { userId: authenticated.userId },
            async (transaction) => {
              const tenant = await resolveTenantContext(
                transaction,
                authenticated.userId,
                body.companyId,
              );
              const claim = await claimIdempotencyKey(transaction, {
                userId: authenticated.userId,
                internalCompanyId: tenant.internalCompanyId,
                operation: UPLOAD_SESSION_IDEMPOTENCY_OPERATION,
                key: headers["idempotency-key"],
                request: idempotencyRequest,
              });
              const stored = claim.replayed
                ? parseReplayClaim(claim, body)
                : canonicalClaim(preflight.session!, body.companyId);
              const session = await readPendingUploadSession(transaction, {
                sessionId: stored.uploadSessionId,
                internalCompanyId: tenant.internalCompanyId,
                userId: authenticated.userId,
                purpose: stored.purpose,
                targetJobId: stored.jobId,
              });
              if (!claim.replayed) {
                await completeIdempotencyClaim(
                  transaction,
                  claim.id,
                  201,
                  canonicalClaim(session, body.companyId),
                );
              }
              return session;
            },
          );
        } catch (error) {
          throw mapDatabaseError(error);
        }
      }

      const signedByPath = new Map(attachments.map((attachment) => [
        attachment.objectPath,
        attachment,
      ]));
      const finalizedAttachments = finalized.attachments.map((attachment) => {
        const signed = signedByPath.get(attachment.objectPath);
        if (!signed) throw new Error("Signed upload target does not match its session manifest");
        return signed;
      });

      reply.code(201);
      return apiSuccess(request.id, JobAttachmentUploadSessionSchema.parse({
        uploadSessionId: finalized.id,
        companyId: body.companyId,
        jobId: finalized.targetJobId,
        expiresAt: finalized.expiresAt.toISOString(),
        attachments: finalizedAttachments,
      }));
    },
  );
}
