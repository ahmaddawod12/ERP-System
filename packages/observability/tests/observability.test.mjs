import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloudLoggingTraceFields,
  safeTraceAttributes,
} from '../dist/index.js';

test('trace attributes are allowlisted and discard sensitive values', () => {
  assert.deepEqual(
    safeTraceAttributes({
      'app.operation': 'document.generate',
      'cloud.pubsub.delivery_attempt': 2,
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      clientEmail: 'person@example.invalid',
      signedUrl: 'https://storage.invalid/signed',
      documentBody: 'private',
      paymentDetails: 'private',
    }),
    {
      'app.operation': 'document.generate',
      'cloud.pubsub.delivery_attempt': 2,
    },
  );
});

test('logging correlation is empty without an active span or project', () => {
  assert.deepEqual(cloudLoggingTraceFields(''), {});
});
