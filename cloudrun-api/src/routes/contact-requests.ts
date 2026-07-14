import {
  ApiFailureResponseSchema,
  ContactRequestCreateRequestSchema,
  ContactRequestCreatedResultSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { ANONYMOUS_CONTACT_CONTEXT_USER_ID } from "../contact-requests/context.js";
import { createContactRequest } from "../contact-requests/repository.js";
import type { ApiDatabaseRuntime } from "../database/runtime.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import {
  claimIdempotencyKey,
  completeIdempotencyClaim,
  readCompletedIdempotencyKey,
} from "../idempotency/repository.js";
import { consumeContactRequestRateLimit } from "../request-limits/repository.js";

const mutationHeadersSchema = z.object({
  "idempotency-key": z.string().trim().min(8).max(128),
}).passthrough();
const createdResponseSchema = createApiSuccessResponseSchema(
  ContactRequestCreatedResultSchema,
);

export interface ContactRequestRouteServices {
  readonly database: ApiDatabaseRuntime;
}

async function enforceContactRateLimit(
  services: ContactRequestRouteServices,
  email: string,
  reply: FastifyReply,
): Promise<void> {
  let rateLimit;
  try {
    rateLimit = await services.database.withTransaction(
      { userId: ANONYMOUS_CONTACT_CONTEXT_USER_ID },
      (transaction) => consumeContactRequestRateLimit(transaction, email),
    );
  } catch (error) {
    throw new AppError({
      statusCode: 503,
      code: "CONTACT_RATE_LIMIT_UNAVAILABLE",
      message: "Contact requests are temporarily unavailable. Try again.",
      retryable: true,
      cause: error,
    });
  }
  if (!rateLimit.allowed) {
    reply.header(
      "retry-after",
      String(Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1_000))),
    );
    throw new AppError({
      statusCode: 429,
      code: "CONTACT_RATE_LIMITED",
      message: "Too many contact requests. Try again later.",
      retryable: true,
    });
  }
}

function mapContactDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const databaseError = error !== null && typeof error === "object"
    ? error as { readonly code?: unknown; readonly message?: unknown }
    : null;
  const code = typeof databaseError?.code === "string" ? databaseError.code : "";
  const message = typeof databaseError?.message === "string" ? databaseError.message : "";
  if (code === "22023" && message.includes("CONTACT_")) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_CONTACT_REQUEST",
      message: "The contact request contains invalid fields.",
      cause: error,
    });
  }
  return error;
}

export function registerContactRequestRoutes(
  app: FastifyInstance,
  services: ContactRequestRouteServices,
): void {
  app.post(
    "/api/v1/contact-requests",
    {
      schema: {
        tags: ["contact"],
        summary: "Create a bounded public contact request",
        headers: mutationHeadersSchema,
        body: ContactRequestCreateRequestSchema,
        response: {
          201: createdResponseSchema,
          400: ApiFailureResponseSchema,
          409: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const headers = mutationHeadersSchema.parse(request.headers);
      const body = ContactRequestCreateRequestSchema.parse(request.body);
      const replay = await services.database.withTransaction(
        { userId: ANONYMOUS_CONTACT_CONTEXT_USER_ID },
        (transaction) => readCompletedIdempotencyKey(transaction, {
          userId: ANONYMOUS_CONTACT_CONTEXT_USER_ID,
          internalCompanyId: null,
          operation: "contact.request.create",
          key: headers["idempotency-key"],
          request: body,
        }),
      );
      if (replay !== null) {
        return reply.code(201).send(apiSuccess(
          request.id,
          ContactRequestCreatedResultSchema.parse(replay.responseBody),
        ));
      }
      await enforceContactRateLimit(services, body.email, reply);

      try {
        const created = await services.database.withTransaction(
          { userId: ANONYMOUS_CONTACT_CONTEXT_USER_ID },
          async (transaction) => {
            const claim = await claimIdempotencyKey(transaction, {
              userId: ANONYMOUS_CONTACT_CONTEXT_USER_ID,
              internalCompanyId: null,
              operation: "contact.request.create",
              key: headers["idempotency-key"],
              request: body,
            });
            if (claim.replayed) {
              return ContactRequestCreatedResultSchema.parse(claim.responseBody);
            }
            const result = await createContactRequest(transaction, body);
            await completeIdempotencyClaim(transaction, claim.id, 201, result);
            return result;
          },
        );
        return reply.code(201).send(apiSuccess(request.id, created));
      } catch (error) {
        throw mapContactDatabaseError(error);
      }
    },
  );
}
