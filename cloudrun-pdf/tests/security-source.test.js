const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const pubsubAuthSource = fs.readFileSync(path.resolve(__dirname, '../pubsub-auth.js'), 'utf8');

test('Pub/Sub verification fails closed when allowlist or OIDC checks fail', () => {
  assert.match(indexSource, /PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0/);
  assert.match(pubsubAuthSource, /return res.status\(403\)\.send\('Service account allowlist not configured'\)/);
  assert.match(pubsubAuthSource, /verifySelfSignedServiceAccountJwt/);
  assert.match(pubsubAuthSource, /return res.status\(401\)\.send\('Trusted bearer token required'\)/);
  assert.match(pubsubAuthSource, /x-pubsub-token/);
});

test('requester identity and company match are enforced before document work', () => {
  assert.match(indexSource, /Missing required task identity fields \(uid and companyId\)/);
  assert.match(indexSource, /Requester profile not found/);
  assert.match(indexSource, /Requester company mismatch/);
  assert.match(indexSource, /Role not authorized for document generation/);
  assert.match(indexSource, /Role not authorized for document preview/);
});

test('worker role is rejected for both document preview and generation', () => {
  // The allowed role list for preview and generate must not include "worker".
  assert.doesNotMatch(indexSource, /\['manager', 'user', 'basic', 'dev', 'worker'\]/);
  assert.doesNotMatch(indexSource, /\['worker', 'manager', 'user', 'basic', 'dev'\]/);
  assert.match(indexSource, /!\['manager', 'user', 'basic', 'dev'\]\.includes\(userRole\)/);
});
