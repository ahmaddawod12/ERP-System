const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { registerGenerateRoute } = require('../routes/generate');

async function withServer(configure, run) {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
  }
}

test('authenticated malformed PDF messages return non-2xx for retry and DLQ', async () => {
  let processed = 0;
  await withServer((app) => registerGenerateRoute(app, {
    verifyPubSubRequest: (_request, _response, next) => next(),
    processGenerateTask: async () => { processed += 1; },
    isTransientProcessingError: () => false,
  }), async (origin) => {
    const response = await fetch(`${origin}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-pubsub-topic': 'projects/example/topics/document-generate',
      },
      body: JSON.stringify({
        deliveryAttempt: 4,
        message: {
          data: Buffer.from('{not-json').toString('base64'),
          attributes: { schemaVersion: 'v1' },
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(processed, 0);
    assert.doesNotMatch(await response.text(), /not-json|data/i);
  });
});

test('permanent PDF failures are acknowledged only after the processor records them', async () => {
  let canonicalFailureRecorded = false;
  const taskId = '11111111-1111-4111-8111-111111111111';
  await withServer((app) => registerGenerateRoute(app, {
    verifyPubSubRequest: (_request, _response, next) => next(),
    processGenerateTask: async () => {
      canonicalFailureRecorded = true;
      throw new TypeError('invalid canonical document');
    },
    isTransientProcessingError: () => false,
  }), async (origin) => {
    const response = await fetch(`${origin}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          data: Buffer.from(JSON.stringify({ taskId })).toString('base64'),
        },
      }),
    });
    assert.equal(canonicalFailureRecorded, true);
    assert.equal(response.status, 200);
  });
});
