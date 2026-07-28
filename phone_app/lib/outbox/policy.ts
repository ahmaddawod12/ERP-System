export type OutboxFailureDisposition =
  | 'retry'
  | 'pause-auth'
  | 'terminal'
  | 'conflict';

export interface OutboxHttpFailure {
  readonly status: number;
  readonly retryable?: boolean;
}

export function classifyOutboxFailure(
  failure: OutboxHttpFailure,
): OutboxFailureDisposition {
  if (failure.status === 401) {
    return 'pause-auth';
  }
  if (failure.status === 409) {
    return 'conflict';
  }
  if (failure.status === 403 || failure.status === 404) {
    return 'terminal';
  }
  if (failure.retryable === false) {
    return 'terminal';
  }
  if (
    failure.retryable
    || failure.status === 0
    || failure.status === 408
    || failure.status === 425
    || failure.status === 429
    || failure.status >= 500
  ) {
    return 'retry';
  }
  return 'terminal';
}

export function retryDelayMs(
  attempts: number,
  random: () => number = Math.random,
): number {
  const boundedAttempts = Math.max(1, Math.min(Math.trunc(attempts), 12));
  const base = Math.min(1_000 * 2 ** (boundedAttempts - 1), 15 * 60_000);
  const jitter = 0.5 + Math.max(0, Math.min(random(), 1)) * 0.5;
  return Math.round(base * jitter);
}
