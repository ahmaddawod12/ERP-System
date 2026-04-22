import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPANY_SYNC_POLL_MAX_INTERVAL_MS,
  COMPANY_SYNC_POLL_MIN_INTERVAL_MS,
  getNextCompanySyncPollIntervalMs,
} from '../contexts/company-sync-poll.ts';

test('company sync polling starts at the minimum interval', () => {
  assert.equal(getNextCompanySyncPollIntervalMs(0), COMPANY_SYNC_POLL_MIN_INTERVAL_MS);
});

test('company sync polling backs off after consecutive idle polls', () => {
  assert.equal(getNextCompanySyncPollIntervalMs(1), COMPANY_SYNC_POLL_MIN_INTERVAL_MS * 2);
  assert.equal(getNextCompanySyncPollIntervalMs(2), COMPANY_SYNC_POLL_MIN_INTERVAL_MS * 4);
});

test('company sync polling caps at the configured maximum interval', () => {
  assert.equal(getNextCompanySyncPollIntervalMs(10), COMPANY_SYNC_POLL_MAX_INTERVAL_MS);
});