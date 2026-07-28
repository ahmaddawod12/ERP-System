import test from 'node:test';
import assert from 'node:assert/strict';
import contracts from '@smart-job/contracts';

const {
  getEnabledModulesForTier,
  getSubscriptionTierForRole,
} = contracts;

test('mobile shares canonical role-to-tier semantics from contracts', () => {
  assert.equal(getSubscriptionTierForRole('basic', 'solo'), 'Basic');
  assert.equal(getSubscriptionTierForRole('user', 'solo'), 'Solo');
  assert.equal(getSubscriptionTierForRole('manager', 'business'), 'Team');
  assert.equal(getSubscriptionTierForRole('dev', 'business'), 'Enterprise');
});

test('tier modules stay aligned with mobile gating expectations', () => {
  const basic = getEnabledModulesForTier('Basic');
  const solo = getEnabledModulesForTier('Solo');
  const team = getEnabledModulesForTier('Team');

  assert.equal(basic.documents, true);
  assert.equal(basic.inventory, false);
  assert.equal(solo.inventory, true);
  assert.equal(team.team, true);
  assert.equal(team.companyinventory, true);
});
