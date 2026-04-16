const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseBearerToken,
  httpStatusFromHttpsErrorCode,
  getClientIp,
} = require('../src/shared-http');

test('parseBearerToken extracts bearer token only from valid auth header', () => {
  assert.equal(parseBearerToken('Bearer abc123'), 'abc123');
  assert.equal(parseBearerToken('bearer abc123'), '');
  assert.equal(parseBearerToken(''), '');
});

test('httpStatusFromHttpsErrorCode maps known codes and defaults to 500', () => {
  assert.equal(httpStatusFromHttpsErrorCode('invalid-argument'), 400);
  assert.equal(httpStatusFromHttpsErrorCode('permission-denied'), 403);
  assert.equal(httpStatusFromHttpsErrorCode('resource-exhausted'), 429);
  assert.equal(httpStatusFromHttpsErrorCode('something-else'), 500);
});

test('getClientIp prefers platform req.ip before forwarded headers', () => {
  assert.equal(
    getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, ip: '9.9.9.9' }),
    '9.9.9.9'
  );
  assert.equal(
    getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, ip: '' }),
    '5.6.7.8'
  );
});
