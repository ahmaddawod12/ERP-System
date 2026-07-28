import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canDeleteUserJob,
  canEditUserJob,
  formatUserJobDate,
  getUserJobStatusColor,
  isUserJobNew,
  type UserJobRecord,
} from '../modules/jobs/lib/user-job-model.ts';

const now = Date.parse('2026-07-22T12:00:00.000Z');

function job(values: Partial<UserJobRecord>): UserJobRecord {
  return values as UserJobRecord;
}

test('recent jobs are marked new and certificate records stay immutable', () => {
  const recent = job({ createdAt: new Date(now - (23 * 60 * 60 * 1000)) });
  const old = job({ createdAt: new Date(now - (25 * 60 * 60 * 1000)) });
  const certificate = job({ isCert: true, finishedAt: new Date(now) });

  assert.equal(isUserJobNew(recent, now), true);
  assert.equal(isUserJobNew(old, now), false);
  assert.equal(canEditUserJob(certificate, now), false);
  assert.equal(canDeleteUserJob(certificate), false);
});

test('finished jobs remain editable for seven days only', () => {
  const withinWindow = job({ finishedAt: new Date(now - (7 * 24 * 60 * 60 * 1000)) });
  const outsideWindow = job({ finishedAt: new Date(now - (8 * 24 * 60 * 60 * 1000)) });

  assert.equal(canEditUserJob(withinWindow, now), true);
  assert.equal(canEditUserJob(outsideWindow, now), false);
});

test('presentation helpers keep canonical status colors and date fallback', () => {
  assert.equal(getUserJobStatusColor('finished'), '#10b981');
  assert.equal(getUserJobStatusColor('pending'), '#f59e0b');
  assert.equal(getUserJobStatusColor('unknown'), '#6b7280');
  assert.equal(formatUserJobDate(null), 'N/A');
});
