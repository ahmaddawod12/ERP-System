const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

test('Pub/Sub verification fails closed when allowlist or OIDC checks fail', () => {
  assert.match(source, /PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0/);
  assert.match(source, /return res.status\(403\)\.send\('Service account allowlist not configured'\)/);
  assert.match(source, /verifySelfSignedServiceAccountJwt/);
  assert.match(source, /return res.status\(401\)\.send\('Trusted bearer token required'\)/);
  assert.match(source, /x-pubsub-token/);
});

test('requester identity and company match are enforced before document work', () => {
  assert.match(source, /Missing required task identity fields \(uid and companyId\)/);
  assert.match(source, /Requester profile not found/);
  assert.match(source, /Requester company mismatch/);
  assert.match(source, /Role not authorized for document generation/);
  assert.match(source, /Role not authorized for document preview/);
});
