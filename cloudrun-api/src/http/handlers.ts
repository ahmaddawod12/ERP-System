import type { FastifyError, FastifyInstance } from "fastify";

import { apiFailure } from "./envelope.js";
import { AppError } from "./errors.js";
import { safeErrorIdentity } from "./logging.js";

interface ValidationIssue {
  readonly instancePath?: string;
  readonly message?: string;
  readonly params?: { readonly missingProperty?: string };
}

function validationFieldErrors(error: FastifyError): Record<string, string[]> | undefined {
  const validation = error.validation as readonly ValidationIssue[] | undefined;
  if (validation === undefined || validation.length === 0) {
    return undefined;
  }

  const fields: Record<string, string[]> = {};
  for (const issue of validation) {
    const missingProperty = issue.params?.missingProperty;
    const path = issue.instancePath?.replace(/^\//, "").replaceAll("/", ".");
    const field = missingProperty ?? (path === undefined || path.length === 0 ? "request" : path);
    const message = issue.message ?? "Invalid value";
    (fields[field] ??= []).push(message);
  }

  return fields;
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const fastifyError = error instanceof Error ? (error as FastifyError) : undefined;
  if (fastifyError?.code === "FST_ERR_HANDLER_TIMEOUT") {
    return new AppError({
      statusCode: 504,
      code: "REQUEST_TIMEOUT",
      message: "The request exceeded the service time limit.",
      retryable: true,
      cause: error,
    });
  }

  if (fastifyError?.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new AppError({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "The request body exceeds the allowed size.",
      cause: error,
    });
  }

  if (fastifyError?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return new AppError({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "The request content type is not supported.",
      cause: error,
    });
  }

  if (
    fastifyError?.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
    || fastifyError?.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    || fastifyError?.code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH"
  ) {
    return new AppError({
      statusCode: 400,
      code: "INVALID_REQUEST_BODY",
      message: "The request body is not valid JSON.",
      cause: error,
    });
  }

  if (fastifyError?.validation !== undefined) {
    const fieldErrors = validationFieldErrors(fastifyError);
    const options = {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "The request did not match the expected format.",
    } as const;

    return new AppError(fieldErrors === undefined ? options : { ...options, fieldErrors });
  }

  return new AppError({
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    retryable: true,
    cause: error,
  });
}

export function registerHttpHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const error = new AppError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    });

    return reply.code(error.statusCode).send(apiFailure(request.id, error.toApiError()));
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeError(error);

    if (normalized.statusCode >= 500) {
      request.log.error(
        { ...safeErrorIdentity(error), errorCode: normalized.code },
        "request failed",
      );
    } else {
      request.log.info(
        {
          ...safeErrorIdentity(error),
          errorCode: normalized.code,
          statusCode: normalized.statusCode,
        },
        "request rejected",
      );
    }

    return reply
      .code(normalized.statusCode)
      .send(apiFailure(request.id, normalized.toApiError()));
  });
}
