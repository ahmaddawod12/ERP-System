import {
  ApiFailureResponseSchema,
  InvitationCreateRequestSchema,
  InvitationCreateResultSchema,
  InvitationRedeemRequestSchema,
  InvitationRedemptionResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
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
} from "../idempotency/repository.js";
import {
  createCompanyInvitation,
  redeemCompanyInvitation,
} from "../invitations/repository.js";
import {
  consumeInvitationRateLimit,
  type InvitationRateLimitOperation,
} from "../invitations/rate-limit-repository.js";
import { resolveTenantContext } from "../tenancy/context.js";
import { listWorkspaceSummaries } from "../workspaces/repository.js";

const invitationParamsSchema = z.object({
  companyId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const idempotencyHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const invitationCreateResponseSchema = createApiSuccessResponseSchema(
  InvitationCreateResultSchema,
);
const invitationRedemptionResponseSchema = createApiSuccessResponseSchema(
  InvitationRedemptionResultSchema,
);

export interface InvitationRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly supabaseUsers: SupabaseUserClient;
}

type InvitationOperation = "create" | "redeem";

async function enforceInvitationRateLimit(
  services: InvitationRouteServices,
  userId: string,
  operation: InvitationRateLimitOperation,
  reply: FastifyReply,
): Promise<void> {
  let rateLimit;
  try {
    rateLimit = await services.database.withTransaction(
      { userId },
      (transaction) => consumeInvitationRateLimit(transaction, operation),
    );
  } catch (error) {
    throw new AppError({
      statusCode: 503,
      code: "INVITATION_RATE_LIMIT_UNAVAILABLE",
      message: "Invitation requests are temporarily unavailable. Try again.",
      retryable: true,
      cause: error,
    });
  }
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1_000),
    );
    reply.header("retry-after", String(retryAfterSeconds));
    throw new AppError({
      statusCode: 429,
      code: "INVITATION_RATE_LIMITED",
      message: "Too many invitation requests. Try again later.",
      retryable: true,
    });
  }
}

function mapInvitationDatabaseError(error: unknown, operation: InvitationOperation): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "P0002" && message.includes("INVITATION_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "INVITATION_NOT_FOUND",
      message: "The invitation was not found for this workspace.",
      cause: error,
    });
  }
  if (code === "P0002" && message.includes("COMPANY_NOT_FOUND")) {
    return new AppError({
      statusCode: 404,
      code: "WORKSPACE_NOT_FOUND",
      message: "The requested workspace was not found.",
      cause: error,
    });
  }
  if (message.includes("EMAIL_VERIFICATION_REQUIRED")) {
    return new AppError({
      statusCode: 403,
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Verify your email before using an invitation.",
      cause: error,
    });
  }
  if (message.includes("INVITATION_EMAIL_MISMATCH")) {
    return new AppError({
      statusCode: 403,
      code: "INVITATION_EMAIL_MISMATCH",
      message: "This invitation belongs to a different verified email address.",
      cause: error,
    });
  }
  if (
    operation === "create"
    && (message.includes("INVITATION_MANAGER_REQUIRED")
      || message.includes("INVITATIONS_MODULE_DISABLED"))
  ) {
    return new AppError({
      statusCode: 403,
      code: "INVITATION_CREATION_FORBIDDEN",
      message: "A manager with team access is required to create invitations.",
      cause: error,
    });
  }
  if (message.includes("INVITATION_CODE_GENERATION_FAILED")) {
    return new AppError({
      statusCode: 503,
      code: "INVITATION_TEMPORARILY_UNAVAILABLE",
      message: "An invitation code could not be reserved. Try again.",
      retryable: true,
      cause: error,
    });
  }
  if (
    message.includes("INVITATION_EXPIRED")
    || message.includes("INVITATION_INACTIVE")
    || message.includes("INVITATION_ALREADY_USED")
    || message.includes("WORKSPACE_MEMBERSHIP_EXISTS")
  ) {
    return new AppError({
      statusCode: 409,
      code: message.includes("WORKSPACE_MEMBERSHIP_EXISTS")
        ? "WORKSPACE_MEMBERSHIP_EXISTS"
        : "INVITATION_UNAVAILABLE",
      message: message.includes("WORKSPACE_MEMBERSHIP_EXISTS")
        ? "This account already belongs to the requested workspace."
        : "The invitation is no longer available.",
      cause: error,
    });
  }
  if (
    code === "22023"
    && (message.includes("INVITATION_") || message.includes("COMPANY_ID_INVALID"))
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_INVITATION",
      message: "The invitation request is invalid.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: operation === "create"
        ? "INVITATION_CREATION_FORBIDDEN"
        : "INVITATION_REDEMPTION_FORBIDDEN",
      message: operation === "create"
        ? "You are not allowed to create invitations for this workspace."
        : "You are not allowed to redeem this invitation.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  services: InvitationRouteServices,
): void {
  app.post(
    "/api/v1/companies/:companyId/invitations",
    {
      schema: {
        tags: ["workspaces", "workers", "invitations"],
        summary: "Create a company invitation as a manager",
        params: invitationParamsSchema,
        headers: idempotencyHeadersSchema,
        body: InvitationCreateRequestSchema,
        response: {
          201: invitationCreateResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const params = invitationParamsSchema.parse(request.params);
      const headers = idempotencyHeadersSchema.parse(request.headers);
      const body = InvitationCreateRequestSchema.parse(request.body);
      const idempotencyRequest = { params, body };

      try {
        await enforceInvitationRateLimit(
          services,
          authenticated.userId,
          "create",
          reply,
        );
        const invitation = await services.database.withTransaction(
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
              operation: "invitation.create",
              key: headers["idempotency-key"],
              request: idempotencyRequest,
            });
            if (claim.replayed) {
              return InvitationCreateResultSchema.parse(claim.responseBody);
            }

            const created = await createCompanyInvitation(transaction, {
              internalCompanyId: tenant.internalCompanyId,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, created);
            return created;
          },
        );
        reply.code(201);
        return apiSuccess(request.id, invitation);
      } catch (error) {
        throw mapInvitationDatabaseError(error, "create");
      }
    },
  );

  app.post(
    "/api/v1/auth/invitations/redeem",
    {
      schema: {
        tags: ["auth", "workspaces", "invitations"],
        summary: "Redeem a company invitation with the verified Auth identity",
        headers: idempotencyHeadersSchema,
        body: InvitationRedeemRequestSchema,
        response: {
          200: invitationRedemptionResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.supabaseUsers);
      const headers = idempotencyHeadersSchema.parse(request.headers);
      const body = InvitationRedeemRequestSchema.parse(request.body);

      try {
        await enforceInvitationRateLimit(
          services,
          authenticated.userId,
          "redeem",
          reply,
        );
        const redemption = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "invitation.redeem",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) {
              return InvitationRedemptionResultSchema.parse(claim.responseBody);
            }

            const membership = await redeemCompanyInvitation(transaction, body);
            const workspaces = await listWorkspaceSummaries(
              transaction,
              authenticated.userId,
            );
            const workspace = workspaces.find(
              (candidate) => candidate.companyId === membership.publicCompanyId,
            );
            if (
              workspace === undefined
              || workspace.memberNo !== membership.memberNo
              || workspace.role !== membership.role
            ) {
              throw new Error("Redeemed workspace could not be read back consistently");
            }

            const result = InvitationRedemptionResultSchema.parse({
              workspace,
              membership: {
                memberNo: membership.memberNo,
                role: membership.role,
                displayName: membership.displayName,
                status: "active",
                joinedAt: membership.joinedAt,
              },
            });
            await completeIdempotencyClaim(transaction, claim.id, 200, result);
            return result;
          },
        );
        return apiSuccess(request.id, redemption);
      } catch (error) {
        throw mapInvitationDatabaseError(error, "redeem");
      }
    },
  );
}
