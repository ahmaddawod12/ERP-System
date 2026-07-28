export type OutboxOperationOutcome =
  | 'terminal'
  | 'retry'
  | 'queued'
  | 'conflict'
  | 'reconciled';

export interface OutboxOperationResult {
  readonly operationId: string;
  readonly outcome: OutboxOperationOutcome;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface OutboxSynchronizationResult {
  readonly operations: readonly OutboxOperationResult[];
}

type PendingOutboxStatus =
  | 'pending'
  | 'syncing'
  | 'retry_wait'
  | 'paused_auth'
  | 'conflict'
  | 'terminal_error';

export function outcomeForOutboxStatus(
  status: PendingOutboxStatus,
): Exclude<OutboxOperationOutcome, 'reconciled'> {
  if (status === 'retry_wait') return 'retry';
  if (status === 'conflict') return 'conflict';
  if (status === 'terminal_error') return 'terminal';
  return 'queued';
}
