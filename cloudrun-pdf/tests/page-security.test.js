const test = require('node:test');
const assert = require('node:assert/strict');

const { hardenPdfPage } = require('../page-security');

test('PDF pages disable JavaScript and block every non-inline request', async () => {
  let handler;
  const calls = [];
  const page = {
    async setJavaScriptEnabled(value) { calls.push(['javascript', value]); },
    async setBypassCSP(value) { calls.push(['csp', value]); },
    async setRequestInterception(value) { calls.push(['interception', value]); },
    on(event, value) {
      assert.equal(event, 'request');
      handler = value;
    },
  };
  await hardenPdfPage(page);
  assert.deepEqual(calls, [
    ['javascript', false],
    ['csp', false],
    ['interception', true],
  ]);

  for (const url of [
    'https://attacker.example/pixel',
    'http://169.254.169.254/metadata',
    'file:///etc/passwd',
    'blob:https://example.test/id',
    'ws://attacker.example/socket',
    'data:text/html,<h1>nested document</h1>',
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    'about:srcdoc',
  ]) {
    let outcome = '';
    handler({
      url: () => url,
      abort: async (reason) => { outcome = `abort:${reason}`; },
      continue: async () => { outcome = 'continue'; },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outcome, 'abort:blockedbyclient', url);
  }

  let inlineOutcome = '';
  handler({
    url: () => 'data:image/png;base64,AAAA',
    abort: async () => { inlineOutcome = 'abort'; },
    continue: async () => { inlineOutcome = 'continue'; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inlineOutcome, 'continue');

  let blankOutcome = '';
  handler({
    url: () => 'about:blank',
    abort: async () => { blankOutcome = 'abort'; },
    continue: async () => { blankOutcome = 'continue'; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blankOutcome, 'continue');
});
