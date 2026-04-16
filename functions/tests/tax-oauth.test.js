const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeBase64Url,
  decodeBase64Url,
  buildAuthCallbackDeepLink,
  generateSuccessHTML,
} = require('../src/tax-oauth');

test('tax oauth helpers round-trip state payloads safely', () => {
  const raw = 'auth-id.state-nonce';
  const encoded = encodeBase64Url(raw);

  assert.notEqual(encoded, raw);
  assert.equal(decodeBase64Url(encoded), raw);
});

test('tax oauth deep links include provided params', () => {
  const link = buildAuthCallbackDeepLink({
    success: true,
    companyId: '1007',
    authId: 'auth-123',
  });

  assert.match(link, /^erpsystem:\/\/auth-callback\?/);
  assert.match(link, /success=true/);
  assert.match(link, /companyId=1007/);
  assert.match(link, /authId=auth-123/);
});

test('tax oauth success html escapes injected error text', () => {
  const html = generateSuccessHTML(
    'erpsystem://auth-callback?success=false',
    false,
    '<script>alert(1)</script>'
  );

  assert.match(html, /Authorization completed with warnings/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
