import {
  ApiFailureResponseSchema,
  WebSessionCreateRequestSchema,
  WebSessionCreatedSchema,
  WebSessionCsrfTokenSchema,
  WebSessionCurrentSchema,
  WebSessionRevokedSchema,
  createApiSuccessResponseSchema,
} from "@smart-job/api-contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { parseAuthorizationCredential } from "../auth/authorization.js";
import { AuthError } from "../auth/errors.js";
import { apiSuccess } from "../http/envelope.js";
import { AppError } from "../http/errors.js";
import type { WebSessionService } from "../web-sessions/service.js";

const createdResponseSchema = createApiSuccessResponseSchema(WebSessionCreatedSchema);
const currentResponseSchema = createApiSuccessResponseSchema(WebSessionCurrentSchema);
const revokedResponseSchema = createApiSuccessResponseSchema(WebSessionRevokedSchema);

function parseSessionAuthorization(request: FastifyRequest): string {
  try {
    const credential = parseAuthorizationCredential(request.headers.authorization);
    if (credential.scheme === "smart-job-session") return credential.token;
  } catch (error) {
    if (error instanceof AuthError && error.code === "AUTHORIZATION_REQUIRED") {
      throw new AppError({
        statusCode: 401,
        code: "WEB_SESSION_REQUIRED",
        message: "An opaque website session is required.",
      });
    }
    if (!(error instanceof AuthError)) throw error;
  }
  throw new AppError({
    statusCode: 401,
    code: "WEB_SESSION_INVALID",
    message: "The website session is invalid or expired.",
  });
}

function parseCsrfHeader(request: FastifyRequest): string {
  const value = request.headers["x-sj-csrf"];
  const parsed = WebSessionCsrfTokenSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      statusCode: 403,
      code: "CSRF_INVALID",
      message: "The CSRF token is missing or invalid.",
    });
  }
  return parsed.data;
}

export interface WebSessionRouteServices {
  readonly webSessions: WebSessionService;
}

export function registerWebSessionRoutes(
  app: FastifyInstance,
  services: WebSessionRouteServices,
): void {
  app.post(
    "/api/v1/auth/web-sessions",
    {
      schema: {
        tags: ["auth"],
        summary: "Create an opaque website session",
        body: WebSessionCreateRequestSchema,
        response: {
          201: createdResponseSchema,
          400: ApiFailureResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          429: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = WebSessionCreateRequestSchema.parse(request.body);
      const session = await services.webSessions.createSession(body.email, body.password);
      return reply.code(201).send(apiSuccess(request.id, session));
    },
  );

  app.get(
    "/api/v1/auth/web-sessions/current",
    {
      schema: {
        tags: ["auth"],
        summary: "Resolve and refresh an opaque website session",
        response: {
          200: currentResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      const current = await services.webSessions.currentSession(
        parseSessionAuthorization(request),
      );
      return apiSuccess(request.id, current);
    },
  );

  app.delete(
    "/api/v1/auth/web-sessions/current",
    {
      schema: {
        tags: ["auth"],
        summary: "Revoke the current opaque website session",
        response: {
          200: revokedResponseSchema,
          401: ApiFailureResponseSchema,
          403: ApiFailureResponseSchema,
          503: ApiFailureResponseSchema,
        },
      },
    },
    async (request) => {
      await services.webSessions.revokeSession(
        parseSessionAuthorization(request),
        parseCsrfHeader(request),
      );
      return apiSuccess(request.id, WebSessionRevokedSchema.parse({ revoked: true }));
    },
  );
}
