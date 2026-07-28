import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeLogValue } from '../utils/logger.ts';

test('mobile logger redacts identifiers, credentials, and contact details', () => {
  const raw = {
    uid: 'user-secret-value',
    companyId: '4f45ee55-a8c1-4f05-8e97-6e23ce620bac',
    nested: {
      email: 'person@example.test',
      phone: '+972 50 123 4567',
      safeCount: 12,
    },
  };
  const serialized = JSON.stringify(sanitizeLogValue(raw));

  assert.doesNotMatch(serialized, /user-secret-value|4f45ee55|person@example|050|50 123/);
  assert.match(serialized, /REDACTED/);
  assert.match(serialized, /safeCount/);
});

test('mobile logger redacts identifiers embedded in diagnostic strings', () => {
  const sanitized = String(sanitizeLogValue(
    'uid=abc123 companyId=42 email person@example.test token?token=secret-value',
  ));

  assert.doesNotMatch(sanitized, /abc123|person@example|secret-value/);
  assert.match(sanitized, /REDACTED/);
});
