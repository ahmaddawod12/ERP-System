import { AppError } from "../http/errors.js";

export type AuthErrorCode =
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_INVALID"
  | "ACCESS_TOKEN_EXPIRED"
  | "AUTH_VERIFICATION_UNAVAILABLE";

interface AuthErrorDefinition {
  readonly statusCode: 401 | 503;
  readonly message: string;
  readonly retryable: boolean;
}

const AUTH_ERROR_DEFINITIONS: Readonly<Record<AuthErrorCode, AuthErrorDefinition>> = {
  AUTHORIZATION_REQUIRED: {
    statusCode: 401,
    message: "An Authorization credential is required.",
    retryable: false,
  },
  AUTHORIZATION_INVALID: {
    statusCode: 401,
    message: "The Authorization credential is invalid.",
    retryable: false,
  },
  ACCESS_TOKEN_EXPIRED: {
    statusCode: 401,
    message: "The access token has expired.",
    retryable: false,
  },
  AUTH_VERIFICATION_UNAVAILABLE: {
    statusCode: 503,
    message: "Authentication verification is temporarily unavailable.",
    retryable: true,
  },
};

/**
 * A deliberately small authentication error that never retains a bearer token,
 * authorization header, or decoded JWT payload.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: 401 | 503;
  readonly retryable: boolean;

  constructor(code: AuthErrorCode) {
    const definition = AUTH_ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = definition.statusCode;
    this.retryable = definition.retryable;
  }

  toAppError(): AppError {
    return new AppError({
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

export function authErrorToAppError(error: AuthError): AppError {
  return error.toAppError();
}
