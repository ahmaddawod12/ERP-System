import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('pending work is visible and supports deliberate retry or discard', async () => {
  const [screen, settings, routes, context, processor] = await Promise.all([
    readSource('../modules/jobs/screens/PendingWork.tsx'),
    readSource('../modules/settings/screens/Settings.tsx'),
    readSource('../navigation/routes.ts'),
    readSource('../contexts/OutboxContext.tsx'),
    readSource('../lib/outbox/processor.ts'),
  ]);

  assert.match(routes, /pendingWork: '\/PendingWork'/);
  assert.match(settings, /router\.push\(ROUTES\.pendingWork\)/);
  assert.match(settings, /pendingOperations\.length/);
  assert.match(screen, /await retry\(operationId\)/);
  assert.match(screen, /alert\.confirm\(/);
  assert.match(screen, /await discard\(operation\.id\)/);
  assert.match(screen, /permanently removes the queued operation and its encrypted attachments/i);
  assert.match(context, /readonly operations: readonly OutboxOperation\[\]/);
  assert.match(context, /readonly synchronizeOperation:/);
  assert.match(context, /readonly retry:/);
  assert.doesNotMatch(context, /deleteDatabase|SecureStore\.deleteItemAsync/);
  assert.match(processor, /outcome: 'reconciled'/);
  assert.match(processor, /outcome: 'retry'/);
  assert.match(processor, /outcome: 'terminal'/);
  assert.match(processor, /outcome: 'conflict'/);
  assert.match(processor, /outcome: 'queued'/);
});

test('staged attachment deletion stays behind reconciliation or explicit discard paths', async () => {
  const [processor, operations] = await Promise.all([
    readSource('../lib/outbox/processor.ts'),
    readSource('../lib/outbox/operations.ts'),
  ]);

  const reconciliation = processor.indexOf('await database.complete(operation.id)');
  const processorDelete = processor.indexOf('deleteStagedAttachment(attachment)');
  const explicitDiscard = operations.indexOf('export async function discardOutboxOperation');
  const discardDelete = operations.lastIndexOf('deleteStagedAttachment(attachment)');
  assert.ok(reconciliation >= 0 && reconciliation < processorDelete);
  assert.ok(explicitDiscard >= 0 && explicitDiscard < discardDelete);
});
