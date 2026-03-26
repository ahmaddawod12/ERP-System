const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getExistingMembership,
  resolveJoinCompanyMembership,
} = require('../src/invite-membership');

test('resolveJoinCompanyMembership rejects cross-company overwrite', () => {
  const result = resolveJoinCompanyMembership({
    profileData: { companyId: 'alpha', role: 'worker', wid: 7 },
    requestedCompanyId: 'beta',
    authUid: 'user-1',
    inviteUsedBy: '',
  });

  assert.deepEqual(result, {
    mode: 'reject',
    code: 'already-exists',
    message: 'User already belongs to another company',
  });
});

test('resolveJoinCompanyMembership reuses existing membership for invite retry', () => {
  const result = resolveJoinCompanyMembership({
    profileData: { companyId: 'alpha', role: 'user', wid: '12' },
    requestedCompanyId: 'alpha',
    authUid: 'user-1',
    inviteUsedBy: 'user-1',
  });

  assert.deepEqual(result, {
    mode: 'reuse_existing',
    membership: {
      companyId: 'alpha',
      role: 'user',
      wid: 12,
    },
  });
});

test('getExistingMembership keeps same-company manager state visible', () => {
  assert.deepEqual(
    getExistingMembership({ companyId: 'alpha', role: 'manager', mid: 1 }),
    { companyId: 'alpha', role: 'manager', wid: null, mid: 1 },
  );
});
