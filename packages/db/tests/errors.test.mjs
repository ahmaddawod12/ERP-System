import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DatabaseError,
  setDatabaseErrorCode,
} from '../dist/errors.js';

test('DatabaseError exposes a typed immutable mapping code', () => {
  const error = new DatabaseError('not-found', 'Missing row');

  assert.equal(error.name, 'DatabaseError');
  assert.equal(error.code, 'not-found');
  assert.equal(error.message, 'Missing row');
});

test('legacy Error instances can receive a non-writable typed code', () => {
  const error = new Error('Missing row');
  setDatabaseErrorCode(error, 'not-found');

  assert.equal(error.code, 'not-found');
  assert.throws(() => {
    error.code = 'permission-denied';
  }, TypeError);
});
