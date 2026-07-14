import { randomUUID } from "node:crypto";

import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import type { ServiceConfig } from "./config.js";
import { failure, success } from "./envelopes.js";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

export interface BuildAppOptions {
  config: ServiceConfig;
  logger?: FastifyServerOptions["logger"];
}

export function buildApp({ config, logger }: BuildAppOptions): FastifyInstance {
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
    request.log.info(
      {
        method: request.method,
        path: requestPath(request.url),
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      "request completed",
    );
  });

  app.get("/healthz", async (request) =>
    success(request.id, { status: "ok" as const, service: "cloudrun-tax" as const }),
  );

  app.get("/readyz", async (request) =>
    success(request.id, { status: "ready" as const, service: "cloudrun-tax" as const }),
  );

  app.setNotFoundHandler(async (request, reply) => {
    return reply
      .code(404)
      .send(failure(request.id, "NOT_FOUND", "The requested route does not exist"));
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (reply.sent) return;
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
