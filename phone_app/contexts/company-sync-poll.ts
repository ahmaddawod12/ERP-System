const COMPANY_SYNC_POLL_MIN_INTERVAL_MS = 15_000;
const COMPANY_SYNC_POLL_MAX_INTERVAL_MS = 120_000;
const COMPANY_SYNC_POLL_BACKOFF_STEPS = 3;

export function getNextCompanySyncPollIntervalMs(consecutiveIdlePolls: number): number {
  const normalizedIdlePolls = Math.max(0, Math.trunc(Number(consecutiveIdlePolls) || 0));
  const backoffStep = Math.min(normalizedIdlePolls, COMPANY_SYNC_POLL_BACKOFF_STEPS);
  return Math.min(COMPANY_SYNC_POLL_MIN_INTERVAL_MS * (2 ** backoffStep), COMPANY_SYNC_POLL_MAX_INTERVAL_MS);
}

export {
  COMPANY_SYNC_POLL_BACKOFF_STEPS,
  COMPANY_SYNC_POLL_MAX_INTERVAL_MS,
  COMPANY_SYNC_POLL_MIN_INTERVAL_MS,
};