export type DatabaseErrorCode =
  | 'already-exists'
  | 'deadline-exceeded'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'not-found'
  | 'permission-denied';

/**
 * Error shape shared by database helpers and their HTTP adapters.
 *
 * Keeping the code on a real Error subclass avoids the former untyped
 * untyped error-code mutation while preserving existing error mapping.
 */
export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

export function setDatabaseErrorCode(
  error: Error,
  code: DatabaseErrorCode,
): asserts error is DatabaseError {
  Object.defineProperty(error, 'code', {
    configurable: true,
    enumerable: true,
    value: code,
    writable: false,
  });
}
