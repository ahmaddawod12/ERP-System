import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOutboxFailure,
  retryDelayMs,
} from '../lib/outbox/policy.ts';
import { outcomeForOutboxStatus } from '../lib/outbox/outcomes.ts';
import { attachmentUploadSessionIdempotencyKey } from '../lib/outbox/idempotency.ts';

test('outbox retry policy follows the field-job transport contract', () => {
  assert.equal(classifyOutboxFailure({ status: 0 }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 0, retryable: false }), 'terminal');
  assert.equal(classifyOutboxFailure({ status: 0, retryable: true }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 408 }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 425 }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 429 }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 503 }), 'retry');
  assert.equal(classifyOutboxFailure({ status: 401 }), 'pause-auth');
  assert.equal(classifyOutboxFailure({ status: 403 }), 'terminal');
  assert.equal(classifyOutboxFailure({ status: 404 }), 'terminal');
  assert.equal(classifyOutboxFailure({ status: 409 }), 'conflict');
});

test('outbox retry delay is jittered and capped', () => {
  assert.equal(retryDelayMs(1, () => 0), 500);
  assert.equal(retryDelayMs(1, () => 1), 1_000);
  assert.equal(retryDelayMs(30, () => 1), 900_000);
});

test('pending operation states map to truthful user-visible outcomes', () => {
  assert.equal(outcomeForOutboxStatus('pending'), 'queued');
  assert.equal(outcomeForOutboxStatus('syncing'), 'queued');
  assert.equal(outcomeForOutboxStatus('paused_auth'), 'queued');
  assert.equal(outcomeForOutboxStatus('retry_wait'), 'retry');
  assert.equal(outcomeForOutboxStatus('terminal_error'), 'terminal');
  assert.equal(outcomeForOutboxStatus('conflict'), 'conflict');
});

test('attachment upload sessions reuse a retry-stable operation-derived key', () => {
  const operationKey = '11111111-1111-4111-8111-111111111111';
  assert.equal(
    attachmentUploadSessionIdempotencyKey(operationKey),
    '11111111-1111-4111-8111-111111111111:attachments',
  );
  assert.equal(
    attachmentUploadSessionIdempotencyKey(operationKey),
    attachmentUploadSessionIdempotencyKey(operationKey),
  );
  assert.throws(() => attachmentUploadSessionIdempotencyKey('short'));
  assert.throws(() => attachmentUploadSessionIdempotencyKey('x'.repeat(128)));
});
