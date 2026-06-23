export const DOCUMENT_TASK_POLL_MIN_INTERVAL_MS = 2000;
export const DOCUMENT_TASK_POLL_MAX_INTERVAL_MS = 10000;

export function getNextDocumentTaskPollIntervalMs(consecutiveInFlightPolls: number): number {
  const safePollCount = Number.isFinite(consecutiveInFlightPolls) && consecutiveInFlightPolls > 0
    ? Math.floor(consecutiveInFlightPolls)
    : 0;
  const interval = DOCUMENT_TASK_POLL_MIN_INTERVAL_MS * (2 ** safePollCount);
  return Math.min(interval, DOCUMENT_TASK_POLL_MAX_INTERVAL_MS);
}
