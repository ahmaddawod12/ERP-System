import type { ApiError } from "@smart-job/api-contracts";

export interface AppErrorOptions {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly fieldErrors?: Record<string, string[]>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.fieldErrors = options.fieldErrors;

    if (!Number.isInteger(this.statusCode) || this.statusCode < 400 || this.statusCode > 599) {
      throw new TypeError("AppError statusCode must be an integer between 400 and 599");
    }
  }

  toApiError(): ApiError {
    return this.fieldErrors === undefined
      ? {
          code: this.code,
          message: this.message,
          retryable: this.retryable,
        }
      : {
          code: this.code,
          message: this.message,
          retryable: this.retryable,
          fieldErrors: this.fieldErrors,
        };
  }
}
