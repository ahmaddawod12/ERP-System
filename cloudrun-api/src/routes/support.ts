import {
  ApiFailureResponseSchema,
  SupportConversationClosedResultSchema,
  SupportConversationCreateRequestSchema,
  SupportConversationListPageSchema,
  SupportConversationListQuerySchema,
  SupportConversationReadResultSchema,
  SupportConversationSummarySchema,
  SupportConversationThreadSchema,
  SupportMessageCreateRequestSchema,
  SupportMessageListQuerySchema,
  SupportMessageSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  requireVerifiedMutationIdentity,
  type ApiRequestAuthenticator,
  type FirebaseUserClient,
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
  appendSupportMessage,
  closeSupportConversation,
  createSupportConversation,
  listSupportConversations,
  markSupportConversationRead,
  readSupportThread,
} from "../support/repository.js";
import { resolveTenantContext } from "../tenancy/context.js";

const conversationParamsSchema = z.object({
  conversationId: z.uuid(),
}).strict();
const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();

const conversationResponseSchema = createApiSuccessResponseSchema(
  SupportConversationSummarySchema,
);
const conversationListResponseSchema = createApiSuccessResponseSchema(
  SupportConversationListPageSchema,
);
const threadResponseSchema = createApiSuccessResponseSchema(
  SupportConversationThreadSchema,
);
const messageResponseSchema = createApiSuccessResponseSchema(SupportMessageSchema);
const readResponseSchema = createApiSuccessResponseSchema(
  SupportConversationReadResultSchema,
);
const closedResponseSchema = createApiSuccessResponseSchema(
  SupportConversationClosedResultSchema,
);

export interface SupportRouteServices {
  readonly authenticator: ApiRequestAuthenticator;
  readonly database: ApiDatabaseRuntime;
  readonly firebaseUsers: FirebaseUserClient;
}

function mapSupportDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";

  if (code === "P0002" && message.includes("SUPPORT_")) {
    return new AppError({
      statusCode: 404,
      code: message.includes("USER") ? "PROFILE_NOT_FOUND" : "SUPPORT_CONVERSATION_NOT_FOUND",
      message: message.includes("USER")
        ? "The authenticated user profile was not found."
        : "The support conversation was not found.",
      cause: error,
    });
  }
  if (code === "42501" && message.includes("SUPPORT_CONVERSATION_ACCESS_DENIED")) {
    return new AppError({
      statusCode: 404,
      code: "SUPPORT_CONVERSATION_NOT_FOUND",
      message: "The support conversation was not found.",
      cause: error,
    });
  }
  if (code === "42501") {
    return new AppError({
      statusCode: 403,
      code: "SUPPORT_FORBIDDEN",
      message: "You are not allowed to perform this support action.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("SUPPORT_CONVERSATION_CLOSED")) {
    return new AppError({
      statusCode: 409,
      code: "SUPPORT_CONVERSATION_CLOSED",
      message: "This support conversation is closed. Start a new conversation to continue.",
      cause: error,
    });
  }
  if (code === "22023" && message.includes("SUPPORT_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_SUPPORT_REQUEST",
      message: "The support request contains invalid fields.",
      cause: error,
    });
  }
  return mapDatabaseError(error);
}

export function registerSupportRoutes(
  app: FastifyInstance,
  services: SupportRouteServices,
): void {
  app.get(
    "/api/v1/support/conversations",
    {
      schema: {
        tags: ["support"],
        summary: "List the viewer's support conversations or the developer queue",
        querystring: SupportConversationListQuerySchema,
        response: {
          200: conversationListResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const query = SupportConversationListQuerySchema.parse(request.query);
      const page = await services.database.withTransaction(
        { userId: authenticated.userId },
        (transaction) => listSupportConversations(transaction, authenticated.userId, query),
      );
      return apiSuccess(request.id, page, page.nextCursor);
    },
  );

  app.post(
    "/api/v1/support/conversations",
    {
      schema: {
        tags: ["support"],
        summary: "Create a support conversation owned by the authenticated viewer",
        headers: mutationHeadersSchema,
        body: SupportConversationCreateRequestSchema,
        response: {
          201: conversationResponseSchema,
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
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = SupportConversationCreateRequestSchema.parse(request.body);

      try {
        const conversation = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const tenant = body.companyId === undefined
              ? null
              : await resolveTenantContext(
                  transaction,
                  authenticated.userId,
                  body.companyId,
                );
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant?.internalCompanyId ?? null,
              operation: "support.conversation.create",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) {
              return SupportConversationSummarySchema.parse(claim.responseBody);
            }
            const created = await createSupportConversation(transaction, {
              userId: authenticated.userId,
              internalCompanyId: tenant?.internalCompanyId ?? null,
              request: body,
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, created);
            return created;
          },
        );
        reply.code(201);
        return apiSuccess(request.id, conversation);
      } catch (error) {
        throw mapSupportDatabaseError(error);
      }
    },
  );

  app.get(
    "/api/v1/support/conversations/:conversationId/messages",
    {
      schema: {
        tags: ["support"],
        summary: "Read one authorized support thread with stable pagination",
        params: conversationParamsSchema,
        querystring: SupportMessageListQuerySchema,
        response: {
          200: threadResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          404: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const authenticated = await services.authenticator.authenticate(request);
      const params = conversationParamsSchema.parse(request.params);
      const query = SupportMessageListQuerySchema.parse(request.query);
      const thread = await services.database.withTransaction(
        { userId: authenticated.userId },
        (transaction) => readSupportThread(transaction, {
          userId: authenticated.userId,
          conversationId: params.conversationId,
          query,
        }),
      );
      return apiSuccess(request.id, thread, thread.nextCursor);
    },
  );

  app.post(
    "/api/v1/support/conversations/:conversationId/messages",
    {
      schema: {
        tags: ["support"],
        summary: "Append a message to an authorized open support conversation",
        params: conversationParamsSchema,
        headers: mutationHeadersSchema,
        body: SupportMessageCreateRequestSchema,
        response: {
          201: messageResponseSchema,
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
      const authenticated = await services.authenticator.authenticate(request);
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = conversationParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = SupportMessageCreateRequestSchema.parse(request.body);

      try {
        const message = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "support.message.append",
              key: headers["idempotency-key"],
              request: { params, body },
            });
            if (claim.replayed) return SupportMessageSchema.parse(claim.responseBody);
            const created = await appendSupportMessage(transaction, {
              conversationId: params.conversationId,
              text: body.text,
            });
            await completeIdempotencyClaim(transaction, claim.id, 201, created);
            return created;
          },
        );
        reply.code(201);
        return apiSuccess(request.id, message);
      } catch (error) {
        throw mapSupportDatabaseError(error);
      }
    },
  );

  app.post(
    "/api/v1/support/conversations/:conversationId/read",
    {
      schema: {
        tags: ["support"],
        summary: "Clear the authenticated side's unread support counter",
        params: conversationParamsSchema,
        headers: mutationHeadersSchema,
        response: {
          200: readResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = conversationParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);

      try {
        const result = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "support.conversation.read",
              key: headers["idempotency-key"],
              request: params,
            });
            if (claim.replayed) {
              return SupportConversationReadResultSchema.parse(claim.responseBody);
            }
            const marked = await markSupportConversationRead(
              transaction,
              params.conversationId,
            );
            await completeIdempotencyClaim(transaction, claim.id, 200, marked);
            return marked;
          },
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapSupportDatabaseError(error);
      }
    },
  );

  app.post(
    "/api/v1/support/conversations/:conversationId/close",
    {
      schema: {
        tags: ["support"],
        summary: "Close an authorized support conversation",
        params: conversationParamsSchema,
        headers: mutationHeadersSchema,
        response: {
          200: closedResponseSchema,
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
      await requireVerifiedMutationIdentity(authenticated, services.firebaseUsers);
      const params = conversationParamsSchema.parse(request.params);
      const headers = mutationHeadersSchema.parse(request.headers);

      try {
        const result = await services.database.withTransaction(
          { userId: authenticated.userId },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: authenticated.userId,
              internalCompanyId: null,
              operation: "support.conversation.close",
              key: headers["idempotency-key"],
              request: params,
            });
            if (claim.replayed) {
              return SupportConversationClosedResultSchema.parse(claim.responseBody);
            }
            const closed = await closeSupportConversation(
              transaction,
              params.conversationId,
            );
            await completeIdempotencyClaim(transaction, claim.id, 200, closed);
            return closed;
          },
        );
        return apiSuccess(request.id, result);
      } catch (error) {
        throw mapSupportDatabaseError(error);
      }
    },
  );
}
