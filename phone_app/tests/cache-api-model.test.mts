import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapSubscriptionToCache,
  mapViewerProfileToCache,
} from '../contexts/cache-api-model.ts';

const bootstrap = {
  workspace: {
    companyId: 42,
    name: 'Acme',
    accountType: 'business' as const,
    role: 'worker' as const,
    memberNo: 7,
    enabledModules: ['inventory', 'solojob'],
  },
  subscription: {
    tier: 'Team' as const,
    status: 'trial' as const,
    enabledModules: ['inventory', 'solojob'],
    expiresAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
  syncState: {
    jobsVersion: 1,
    documentsVersion: 2,
    clientsVersion: 3,
    workersVersion: 4,
    companyInventoryVersion: 5,
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
  counts: {
    jobs: 1,
    clients: 2,
    inventoryParts: 3,
    documents: 4,
    pendingDocumentTasks: 0,
  },
};

test('Cloud API profile and workspace data map to the legacy cache identity shape', () => {
  const profile = mapViewerProfileToCache({
    uid: '9b3792bb-8f01-46d8-9817-f552f91e7faa',
    email: 'worker@example.com',
    displayName: 'Worker Seven',
    phoneNumber: '+972500000000',
    systemRole: null,
    companyId: 42,
    updatedAt: '2026-07-18T00:00:00.000Z',
  }, bootstrap);

  assert.equal(profile.role, 'worker');
  assert.equal(profile.companyId, '42');
  assert.equal(profile.wid, 7);
  assert.equal(profile.name, 'Worker Seven');
});

test('Cloud API subscription modules map to boolean cache entitlements', () => {
  const subscription = mapSubscriptionToCache(bootstrap);
  assert.equal(subscription?.status, 'trial');
  assert.equal(subscription?.tier, 'Team');
  assert.deepEqual(subscription?.enabledModules, {
    inventory: true,
    solojob: true,
  });
});
