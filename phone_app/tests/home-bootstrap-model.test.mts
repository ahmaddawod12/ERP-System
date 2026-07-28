import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BootstrapCountsSchema,
  WorkspaceSummarySchema,
} from '@smart-job/api-contracts';

import {
  bootstrapCountValues,
  canLoadBasicProfile,
  canLoadManagerBootstrap,
  canLoadUserBootstrap,
  canLoadWorkerBootstrap,
} from '../modules/home/lib/home-bootstrap-model.ts';

function workspace(input: {
  role: 'manager' | 'worker' | 'user' | 'basic' | 'dev';
  enabledModules: string[];
}) {
  return WorkspaceSummarySchema.parse({
    companyId: 17,
    name: 'Smart Job',
    accountType: 'business',
    role: input.role,
    memberNo: input.role === 'dev' ? null : 1,
    enabledModules: input.enabledModules,
  });
}

test('manager bootstrap gating requires a trusted role and dashboard module', () => {
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'manager', enabledModules: ['solojob'] })), true);
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'dev', enabledModules: ['documents'] })), true);
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'manager', enabledModules: ['team'] })), false);
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'manager', enabledModules: [] })), false);
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'worker', enabledModules: ['team'] })), false);
  assert.equal(canLoadManagerBootstrap(workspace({ role: 'basic', enabledModules: ['documents'] })), false);
  assert.equal(canLoadManagerBootstrap(null), false);
});

test('user and worker bootstrap gating uses trusted workspace roles and canonical modules', () => {
  assert.equal(canLoadUserBootstrap(workspace({ role: 'user', enabledModules: ['clients'] })), true);
  assert.equal(canLoadUserBootstrap(workspace({ role: 'user', enabledModules: ['documents'] })), true);
  assert.equal(canLoadUserBootstrap(workspace({ role: 'user', enabledModules: [] })), false);
  assert.equal(canLoadUserBootstrap(workspace({ role: 'manager', enabledModules: ['clients'] })), false);

  assert.equal(canLoadWorkerBootstrap(workspace({ role: 'worker', enabledModules: ['solojob'] })), true);
  assert.equal(canLoadWorkerBootstrap(workspace({ role: 'worker', enabledModules: ['inventory'] })), true);
  assert.equal(canLoadWorkerBootstrap(workspace({ role: 'worker', enabledModules: ['team'] })), false);
  assert.equal(canLoadWorkerBootstrap(workspace({ role: 'user', enabledModules: ['solojob'] })), false);
  assert.equal(canLoadWorkerBootstrap(null), false);
});

test('basic profile gating ignores tier-only flags and requires a canonical entitlement', () => {
  assert.equal(canLoadBasicProfile(workspace({ role: 'basic', enabledModules: ['documents'] })), true);
  assert.equal(canLoadBasicProfile(workspace({ role: 'basic', enabledModules: ['clients'] })), true);
  assert.equal(canLoadBasicProfile(workspace({ role: 'basic', enabledModules: [] })), false);
  assert.equal(canLoadBasicProfile(workspace({ role: 'basic', enabledModules: ['team'] })), false);
  assert.equal(canLoadBasicProfile(workspace({ role: 'manager', enabledModules: ['documents'] })), false);
  assert.equal(canLoadBasicProfile(null), false);
});

test('bootstrap count metrics never infer totals from collection payloads', () => {
  const counts = BootstrapCountsSchema.parse({
    jobs: 9,
    clients: 8,
    inventoryParts: 7,
    documents: 6,
    pendingDocumentTasks: 5,
  });

  assert.deepEqual(bootstrapCountValues(counts), {
    jobs: '9',
    clients: '8',
    inventoryParts: '7',
    documents: '6',
    pendingDocumentTasks: '5',
  });
  assert.deepEqual(bootstrapCountValues(null), {
    jobs: '—',
    clients: '—',
    inventoryParts: '—',
    documents: '—',
    pendingDocumentTasks: '—',
  });
});

test('role dashboards use one tenant-scoped, runtime-validated, retryable bootstrap', async () => {
  const [hook, managerScreen, userScreen, workerScreen, apiClient] = await Promise.all([
    readFile(new URL('../modules/home/lib/use-company-bootstrap.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/home/screens/ManagerHomepage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/home/screens/UserHomepage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/home/screens/WorkerHomepage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/api/client.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(hook, /tenantQueryKey\(uid, companyId, 'bootstrap'\)/);
  assert.match(hook, /fetchCompanyBootstrap\(uid, companyId, signal\)/);
  assert.match(hook, /previousKey\[1\] === uid/);
  assert.match(hook, /previousKey\[2\] === companyId/);
  assert.doesNotMatch(hook, /readModelV1|MMKV|firebase/i);
  assert.match(managerScreen, /useCompanyBootstrap/);
  assert.match(managerScreen, /canLoadManagerBootstrap\(workspace\)/);
  assert.match(managerScreen, /bootstrapQuery\.refetch\(\)/);
  assert.doesNotMatch(managerScreen, /useCache|isSubscriptionActive|callHttpFunction|readModelV1/);
  assert.match(userScreen, /useCompanyBootstrap/);
  assert.match(userScreen, /canLoadUserBootstrap\(workspace\)/);
  assert.match(userScreen, /bootstrapQuery\.refetch\(\)/);
  assert.doesNotMatch(userScreen, /useCache|isModuleEnabled|callHttpFunction|readModelV1/);
  assert.match(workerScreen, /useCompanyBootstrap/);
  assert.match(workerScreen, /canLoadWorkerBootstrap\(workspace\)/);
  assert.match(workerScreen, /enabledModules\.has\('solojob'\)/);
  assert.match(workerScreen, /bootstrapQuery\.refetch\(\)/);
  assert.doesNotMatch(workerScreen, /useCache|isModuleEnabled|callHttpFunction|readModelV1/);
  assert.match(apiClient, /CompanyBootstrapSchema/);
});

test('basic profile uses the runtime-validated tenant API and retains only same-tenant data', async () => {
  const [hook, basicScreen, apiClient] = await Promise.all([
    readFile(new URL('../modules/home/lib/use-business-profile.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/home/screens/BasicHomepage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/api/client.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(hook, /tenantQueryKey\(uid, companyId, 'business-profile'\)/);
  assert.match(hook, /fetchBusinessProfile\(uid, companyId, signal\)/);
  assert.match(hook, /previousKey\[1\] === uid/);
  assert.match(hook, /previousKey\[2\] === companyId/);
  assert.match(hook, /refetchOnMount: true/);
  assert.doesNotMatch(hook, /readModelV1|MMKV|firebase/i);

  assert.match(apiClient, /BusinessProfileSchema/);
  assert.match(apiClient, /`\/api\/v1\/companies\/\$\{companyId\}\/profile`/);
  assert.match(basicScreen, /useBusinessProfile/);
  assert.match(basicScreen, /canLoadBasicProfile\(workspace\)/);
  assert.match(basicScreen, /profileQuery\.refetch\(\)/);
  assert.doesNotMatch(
    basicScreen,
    /useCache|isSubscriptionActive|isModuleEnabled|callHttpFunction|readModelV1|includeCollections|console\./,
  );
});
