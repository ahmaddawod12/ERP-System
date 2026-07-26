import { randomUUID } from "node:crypto";
import { cloudLoggingTraceFields } from "@smart-job/observability";

import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import type { TaxCallbackAuthenticator } from "./callback.js";
import { parseTaxCallback } from "./callback.js";
import type { TaxAuthorityClient } from "./authority-client.js";
import type { MainApiCallbackClient } from "./main-api-client.js";
import type { ServiceIdentityVerifier } from "./service-identity.js";
import type { ServiceConfig } from "./config.js";
import { TaxApprovalRouteRequestSchema, TaxCallbackEnvelopeSchema } from "./contracts.js";
import { TaxGatewayError, dependencyUnavailable, taxSubmissionDisabled } from "./errors.js";
import { failure, success } from "./envelopes.js";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TAX_EVENT_ID_HEADER = "x-sj-tax-event-id";
const TAX_TIMESTAMP_HEADER = "x-sj-tax-timestamp";
const TAX_SIGNATURE_HEADER = "x-sj-tax-signature";

function requestPath(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function safeErrorIdentity(error: unknown): { errorType: string; errorCode?: string } {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code = Reflect.get(error, "code");
  return {
    errorType: error.name,
    ...(typeof code === "string" ? { errorCode: code } : {}),
  };
}

function classifyClientError(error: unknown): {
  statusCode: 400 | 413 | 415;
  code: string;
  message: string;
} | null {
  const fastifyCode = error instanceof Error ? Reflect.get(error, "code") : undefined;
  if (fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return {
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "The request body exceeds the allowed size.",
    };
  }
  if (fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return {
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "The request content type is not supported.",
    };
  }
  if (
    fastifyCode === "FST_ERR_CTP_EMPTY_JSON_BODY"
    || fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY"
    || fastifyCode === "FST_ERR_CTP_INVALID_CONTENT_LENGTH"
  ) {
    return {
      statusCode: 400,
      code: "INVALID_REQUEST_BODY",
      message: "The request body is not valid JSON.",
    };
  }
  return null;
}

function requestIdFromHeader(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined;
}

export interface BuildAppDependencies {
  readonly authorityClient?: TaxAuthorityClient;
  readonly callbackAuthenticator?: TaxCallbackAuthenticator;
  readonly callbackClient?: MainApiCallbackClient;
  readonly approvalIdentityVerifier?: ServiceIdentityVerifier;
}

export interface BuildAppOptions {
  config: ServiceConfig;
  logger?: FastifyServerOptions["logger"];
  dependencies?: BuildAppDependencies;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function buildApp({ config, logger, dependencies }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      logger ??
      ({
        level: config.logLevel,
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-cloud-trace-context']",
            "headers.authorization",
            "headers.cookie",
            "body",
            "req.body",
            "request.body",
            "*.clientSecret",
            "*.accessToken",
            "*.refreshToken",
          ],
          censor: "[REDACTED]",
        },
        serializers: {
          req(request) {
            return {
              id: request.id,
              method: request.method,
              path: requestPath(request.url),
              remoteAddress: request.ip,
            };
          },
        },
        mixin: () => cloudLoggingTraceFields(),
      } satisfies NonNullable<FastifyServerOptions["logger"]>),
    genReqId(request) {
      return requestIdFromHeader(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    request.log.info(
      { method: request.method, path: requestPath(request.url) },
      "request received",
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    const path = requestPath(request.url);
    request.log.info(
      {
        method: request.method,
        path,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      "request completed",
    );
    if (reply.statusCode >= 500 && request.method === "POST") {
      if (path === "/api/v1/tax/callback") {
        request.log.error(
          { taxCallbackFailure: true, statusCode: reply.statusCode },
          "tax callback failed",
        );
      } else if (path === "/api/v1/tax/approval") {
        request.log.error(
          { taxSubmissionFailure: true, statusCode: reply.statusCode },
          "tax approval failed",
        );
      }
    }
  });

  app.get("/healthz", async (request) =>
    success(request.id, { status: "ok" as const, service: "cloudrun-tax" as const }),
  );
  app.get("/health", async (request) =>
    success(request.id, { status: "ok" as const, service: "cloudrun-tax" as const }),
  );

  app.get("/readyz", async (request, reply) => {
    const ready = config.taxSubmissionMode === "disabled"
      || (
        config.authority !== undefined
        && config.callback !== undefined
        && config.mainApi !== undefined
        && config.taxGatewayAudience.length > 0
        && config.taxApprovalCallerServiceAccount.length > 0
      );
    if (!ready) {
      return reply.code(503).send(
        failure(
          request.id,
          "NOT_READY",
          "Tax gateway configuration is unavailable.",
          true,
        ),
      );
    }
    return success(request.id, {
      status: "ready" as const,
      service: "cloudrun-tax" as const,
      submissionMode: config.taxSubmissionMode,
    });
  });

  app.post("/api/v1/tax/callback", async (request, reply) => {
    const callbackAuthenticator = dependencies?.callbackAuthenticator;
    const callbackClient = dependencies?.callbackClient;

    if (callbackAuthenticator === undefined || callbackClient === undefined) {
      const unavailable = dependencyUnavailable();
      return reply
        .code(unavailable.statusCode)
        .send(failure(request.id, unavailable.code, unavailable.safeMessage, unavailable.retryable));
    }

    const eventId = singleHeader(request.headers[TAX_EVENT_ID_HEADER]);
    const timestamp = singleHeader(request.headers[TAX_TIMESTAMP_HEADER]);
    const signature = singleHeader(request.headers[TAX_SIGNATURE_HEADER]);
    if (eventId === undefined || timestamp === undefined || signature === undefined) {
      return reply
        .code(401)
        .send(failure(request.id, "INVALID_CALLBACK_AUTHENTICATION", "The tax callback could not be authenticated.", false));
    }

    const envelopeParse = TaxCallbackEnvelopeSchema.safeParse(request.body);
    if (!envelopeParse.success) {
      return reply
        .code(400)
        .send(failure(request.id, "INVALID_REQUEST", "The request does not match the tax callback contract.", false));
    }

    try {
      callbackAuthenticator.verify({ eventId, timestamp, signature, encodedData: envelopeParse.data.message.data });
      const parsed = parseTaxCallback(envelopeParse.data, eventId);
      const result = await callbackClient.forwardCallback({
        eventId,
        payloadHash: parsed.payloadHash,
        requestId: request.id,
        callback: parsed.callback,
      });
      return reply.send(success(request.id, result));
    } catch (error) {
      if (error instanceof TaxGatewayError) {
        request.log.info(safeErrorIdentity(error), "tax callback rejected");
        return reply
          .code(error.statusCode)
          .send(failure(request.id, error.code, error.safeMessage, error.retryable));
      }
      throw error;
    }
  });

  app.post("/api/v1/tax/approval", async (request, reply) => {
    if (config.taxSubmissionMode === "disabled") {
      const unavailable = taxSubmissionDisabled();
      return reply
        .code(unavailable.statusCode)
        .send(failure(request.id, unavailable.code, unavailable.safeMessage, unavailable.retryable));
    }

    const authorityClient = dependencies?.authorityClient;
    const mainApiClient = dependencies?.callbackClient;
    const identityVerifier = dependencies?.approvalIdentityVerifier;

    if (authorityClient === undefined || mainApiClient === undefined || identityVerifier === undefined) {
      const unavailable = dependencyUnavailable();
      return reply
        .code(unavailable.statusCode)
        .send(failure(request.id, unavailable.code, unavailable.safeMessage, unavailable.retryable));
    }

    const bodyParse = TaxApprovalRouteRequestSchema.safeParse(request.body);
    if (!bodyParse.success) {
      return reply
        .code(400)
        .send(failure(request.id, "INVALID_REQUEST", "The request does not match the tax approval contract.", false));
    }

    try {
      await identityVerifier.verifyAuthorizationHeader(request.headers.authorization);

      await mainApiClient.bindApprovalSession({
        documentId: bodyParse.data.documentId,
        oauthSessionId: bodyParse.data.oauthSessionId,
        requestId: request.id,
      });

      const tokenResult = await authorityClient.exchangeToken({ grantType: "client_credentials" });
      const approvalResult = await authorityClient.requestApproval({
        accessToken: tokenResult.accessToken,
        oauthSessionId: bodyParse.data.oauthSessionId,
        invoice: bodyParse.data.invoice,
      });

      return reply.send(success(request.id, approvalResult));
    } catch (error) {
      if (error instanceof TaxGatewayError) {
        request.log.info(safeErrorIdentity(error), "tax approval rejected");
        return reply
          .code(error.statusCode)
          .send(failure(request.id, error.code, error.safeMessage, error.retryable));
      }
      throw error;
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply
      .code(404)
      .send(failure(request.id, "NOT_FOUND", "The requested route does not exist"));
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (reply.sent) return;
    if (error instanceof TaxGatewayError) {
      request.log.info(safeErrorIdentity(error), "tax gateway error");
      return reply
        .code(error.statusCode)
        .send(failure(request.id, error.code, error.safeMessage, error.retryable));
    }
    const clientError = classifyClientError(error);
    if (clientError !== null) {
      request.log.info(
        { ...safeErrorIdentity(error), statusCode: clientError.statusCode },
        "request rejected",
      );
      return reply
        .code(clientError.statusCode)
        .send(failure(request.id, clientError.code, clientError.message));
    }
    request.log.error(safeErrorIdentity(error), "request failed");
    return reply
      .code(500)
      .send(failure(request.id, "INTERNAL_ERROR", "An unexpected error occurred", true));
  });

  return app;
}
