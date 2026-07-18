import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArchiveCompletedAt } from '../dist/archive.js';

test('archive completion timestamps are normalized for Drizzle date columns', () => {
  const value = normalizeArchiveCompletedAt('2026-07-18T12:34:56.000Z');
  assert.ok(value instanceof Date);
  assert.equal(value.toISOString(), '2026-07-18T12:34:56.000Z');
  assert.equal(normalizeArchiveCompletedAt(null), null);
});

test('invalid archive completion timestamps fail before the upsert', () => {
  assert.throws(
    () => normalizeArchiveCompletedAt('not-a-date'),
    (error) => error instanceof Error && error.code === 'invalid-argument',
  );
});
