import assert from 'node:assert/strict';
import test from 'node:test';

import { requireSqlCipherVersion } from '../lib/outbox/sqlcipher.ts';

test('an SQLite build without SQLCipher is rejected', () => {
  assert.throws(
    () => requireSqlCipherVersion([]),
    /SQLCipher is required/,
  );
  assert.throws(
    () => requireSqlCipherVersion([{ cipher_version: '' }]),
    /SQLCipher is required/,
  );
  assert.throws(
    () => requireSqlCipherVersion([{ cipher_version: null }]),
    /SQLCipher is required/,
  );
});

test('a non-empty SQLCipher version enables the encrypted outbox check', () => {
  assert.equal(
    requireSqlCipherVersion([{ cipher_version: ' 4.10.0 community ' }]),
    '4.10.0 community',
  );
});
