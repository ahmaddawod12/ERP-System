import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_TASK_POLL_MAX_INTERVAL_MS,
  DOCUMENT_TASK_POLL_MIN_INTERVAL_MS,
  getNextDocumentTaskPollIntervalMs,
} from '../hooks/document-task-poll.ts';

test('document task polling starts at the minimum interval', () => {
  assert.equal(getNextDocumentTaskPollIntervalMs(0), DOCUMENT_TASK_POLL_MIN_INTERVAL_MS);
});

test('document task polling backs off while work remains in flight', () => {
  assert.equal(getNextDocumentTaskPollIntervalMs(1), DOCUMENT_TASK_POLL_MIN_INTERVAL_MS * 2);
  assert.equal(getNextDocumentTaskPollIntervalMs(2), DOCUMENT_TASK_POLL_MIN_INTERVAL_MS * 4);
});

test('document task polling caps at the configured maximum interval', () => {
  assert.equal(getNextDocumentTaskPollIntervalMs(10), DOCUMENT_TASK_POLL_MAX_INTERVAL_MS);
});