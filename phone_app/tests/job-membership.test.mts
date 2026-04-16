import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobMembershipQueryValues,
  normalizeMembershipId,
  roleUsesScopedJobAccess,
} from '../contexts/job-membership.ts';

test('worker and user roles require scoped job access', () => {
  assert.equal(roleUsesScopedJobAccess('worker'), true);
  assert.equal(roleUsesScopedJobAccess('user'), true);
  assert.equal(roleUsesScopedJobAccess('manager'), false);
  assert.equal(roleUsesScopedJobAccess('basic'), false);
});

test('membership ids are normalized for mixed legacy numeric/string job docs', () => {
  assert.equal(normalizeMembershipId(' 7 '), '7');
  assert.deepEqual(buildJobMembershipQueryValues('7'), ['7', 7]);
  assert.deepEqual(buildJobMembershipQueryValues(12), ['12', 12]);
  assert.deepEqual(buildJobMembershipQueryValues('worker-7'), ['worker-7']);
  assert.deepEqual(buildJobMembershipQueryValues('   '), []);
});
