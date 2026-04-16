import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProfileCacheOwnedByUser,
  resolveCachedSessionIdentity,
} from '../contexts/cache-identity.ts';

test('cache identity refuses scoped cache from a different authenticated user', () => {
  const resolved = resolveCachedSessionIdentity({
    expectedUid: 'user-b',
    cachedUid: 'user-a',
    cachedRole: 'manager',
    cachedCompanyId: 'company-a',
  });

  assert.deepEqual(resolved, {
    uid: 'user-b',
    role: null,
    companyId: null,
    canReadScopedCache: false,
    identityMismatch: true,
  });
});

test('matching users can reuse scoped cache metadata', () => {
  const resolved = resolveCachedSessionIdentity({
    expectedUid: 'user-a',
    cachedUid: 'user-a',
    cachedRole: 'worker',
    cachedCompanyId: 'company-a',
  });

  assert.deepEqual(resolved, {
    uid: 'user-a',
    role: 'worker',
    companyId: 'company-a',
    canReadScopedCache: true,
    identityMismatch: false,
  });
});

test('profile cache ownership rejects foreign cached profiles', () => {
  assert.equal(isProfileCacheOwnedByUser({ uid: 'user-a' }, 'user-a'), true);
  assert.equal(isProfileCacheOwnedByUser({ uid: 'user-a' }, 'user-b'), false);
  assert.equal(isProfileCacheOwnedByUser({}, 'user-b'), true);
});
