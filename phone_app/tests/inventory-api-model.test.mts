import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  InventoryPartSummarySchema,
  WorkspaceSummarySchema,
} from '@smart-job/api-contracts';

import {
  buildInventoryListPath,
  mapInventoryPartSummary,
  mergeInventoryPartPages,
  normalizeInventoryListFilters,
  resolveInventoryReadScope,
} from '../modules/inventory/lib/inventory-list-model.ts';
import { StableInventoryActionKeys } from '../modules/inventory/lib/inventory-action-keys.ts';

const part = InventoryPartSummarySchema.parse({
  partId: '11111111-1111-4111-8111-111111111111',
  partNo: 42,
  status: 'active',
  name: 'Compressor',
  active: true,
  quantity: 12.5,
  lowThreshold: 3,
  unit: 'piece',
  entityVersion: 'ev1.MQ',
  stockEntityVersion: 'ev1.Mg',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T09:00:00.000Z',
  archivedAt: null,
});

function workspace(role: 'manager' | 'worker' | 'user' | 'basic' | 'dev', enabled: boolean) {
  return WorkspaceSummarySchema.parse({
    companyId: 17,
    name: 'Smart Job',
    accountType: 'business',
    role,
    memberNo: role === 'dev' ? null : 1,
    enabledModules: enabled ? ['inventory'] : [],
  });
}

test('inventory role and module gates select only authorized API scopes', () => {
  assert.equal(resolveInventoryReadScope(workspace('manager', true)), 'company');
  assert.equal(resolveInventoryReadScope(workspace('user', true)), 'company');
  assert.equal(resolveInventoryReadScope(workspace('dev', true)), 'company');
  assert.equal(resolveInventoryReadScope(workspace('worker', true)), 'member');
  assert.equal(resolveInventoryReadScope(workspace('basic', true)), null);
  assert.equal(resolveInventoryReadScope(workspace('manager', false)), null);
});

test('inventory filters are canonical, bounded, and preserve opaque cursors', () => {
  const filters = normalizeInventoryListFilters({
    status: ['archived', 'active', 'inactive', 'active'],
    search: `  ${'c'.repeat(100)}  `,
    pageSize: 999,
  });

  assert.deepEqual(filters.statuses, ['active', 'inactive', 'archived']);
  assert.equal(filters.search?.length, 80);
  assert.equal(filters.pageSize, 200);
  assert.equal(
    buildInventoryListPath(17, 'member', filters, 'opaque+cursor/='),
    `/api/v1/companies/17/inventory/me?status=active&status=inactive&status=archived&search=${'c'.repeat(80)}&pageSize=200&afterCursor=opaque%2Bcursor%2F%3D`,
  );
  assert.match(
    buildInventoryListPath(17, 'member', filters, null, 42),
    /^\/api\/v1\/companies\/17\/inventory\/members\/42\?/,
  );
});

test('API inventory maps UUID identity separately from the public part number', () => {
  const mapped = mapInventoryPartSummary(part);

  assert.equal(mapped.partId, part.partId);
  assert.equal(mapped.partNo, 42);
  assert.equal(mapped.id, 42);
  assert.equal(mapped.quantity, 12.5);
  assert.equal(mapped.unit, 'piece');
  assert.equal(mapped.entityVersion, 'ev1.MQ');
  assert.equal(mapped.stockEntityVersion, 'ev1.Mg');
});

test('overlapping inventory cursor pages merge without duplicate parts', () => {
  const parts = mergeInventoryPartPages([
    { items: [part] },
    { items: [part] },
  ]);

  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.partId, part.partId);
});

test('inventory action retries keep their idempotency key until server confirmation', () => {
  let next = 0;
  const keys = new StableInventoryActionKeys(() => `inventory-key-${++next}`);
  const first = keys.keyFor('adjust:part-1', 'same-payload');
  assert.equal(keys.keyFor('adjust:part-1', 'same-payload'), first);
  assert.notEqual(keys.keyFor('adjust:part-1', 'changed-payload'), first);
  const current = keys.keyFor('adjust:part-1', 'changed-payload');
  keys.complete('adjust:part-1', current);
  assert.notEqual(keys.keyFor('adjust:part-1', 'changed-payload'), current);
});

test('inventory screens use authenticated tenant API queries and mutations only', async () => {
  const [companyScreen, workerScreen, userScreen, hook, mutationHook, api, route] = await Promise.all([
    readFile(new URL('../modules/inventory/screens/CompanyInventory.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/inventory/screens/WorkerInventory.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/inventory/screens/UserInventory.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/inventory/lib/use-inventory-infinite.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/inventory/lib/use-inventory-mutations.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/inventory/lib/inventory-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/inventory.tsx', import.meta.url), 'utf8'),
  ]);

  for (const screen of [companyScreen, workerScreen]) {
    assert.match(screen, /useInventoryInfinite/);
    assert.match(screen, /fetchNextPage/);
    assert.match(screen, /\.refetch\(\)/);
    assert.doesNotMatch(screen, /cachedInventory|cachedCompanyInventory|fetchUserInventoryParts/);
  }
  assert.match(workerScreen, /catalogUnavailable/);
  assert.doesNotMatch(workerScreen, /showCompanyPicker|readModelV1/);
  assert.match(workerScreen, /scope: 'member'/);
  assert.match(workerScreen, /stockEntityVersion: part\.stockEntityVersion/);
  assert.match(workerScreen, /randomUUID\(\)/);
  assert.match(companyScreen, /entityVersion: part\.entityVersion/);
  assert.match(companyScreen, /workspace\?\.role === 'manager' \|\| workspace\?\.role === 'dev'/);
  assert.match(companyScreen, /randomUUID\(\)/);
  assert.doesNotMatch(`${companyScreen}\n${workerScreen}`, /httpsCallable|updateInventoryV1|targetUid|from ['"].*firebase/);
  assert.doesNotMatch(workerScreen, /replaceParts/);
  assert.match(userScreen, /CompanyInventory/);
  assert.match(hook, /tenantQueryKey\(uid, companyId, 'inventory'/);
  assert.match(hook, /useInfiniteQuery/);
  assert.match(mutationHook, /invalidateTenantQueries\(uid, companyId, 'inventory'/);
  assert.match(mutationHook, /adjustInventoryStock/);
  assert.match(mutationHook, /transferInventoryStock/);
  assert.match(mutationHook, /pickInventoryStock/);
  assert.match(api, /requestApi/);
  assert.match(api, /InventoryPartCreateRequestSchema\.parse/);
  assert.match(api, /InventoryPartUpdateRequestSchema\.parse/);
  assert.match(api, /InventoryAdjustmentRequestSchema\.parse/);
  assert.match(api, /companyInventoryPath\(input\.companyId\)\}\/transfers/);
  assert.match(api, /companyInventoryPath\(input\.companyId\)\}\/picks/);
  assert.doesNotMatch(api, /readModelV1|MMKV|firebase/i);
  assert.match(route, /resolveInventoryReadScope/);
  assert.match(route, /NotAvailableScreen/);
});
