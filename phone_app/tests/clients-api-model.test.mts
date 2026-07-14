import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ClientSummarySchema } from '@smart-job/api-contracts';

import {
  buildClientListPath,
  mapClientSummary,
  mergeClientSummaryPages,
  normalizeClientListFilters,
} from '../modules/clients/lib/client-list-model.ts';
import { StableClientActionKeys } from '../modules/clients/lib/client-action-keys.ts';

const firstClient = ClientSummarySchema.parse({
  clientId: '11111111-1111-4111-8111-111111111111',
  clientNo: 42,
  status: 'active',
  name: 'Northwind Cooling',
  phone: '0501234567',
  email: 'service@northwind.example',
  address: '1 Harbor Road',
  city: 'Haifa',
  vatNumber: '123456789',
  notes: null,
  entityVersion: 'client-version-1',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
  archivedAt: null,
});

test('client filters are bounded and opaque cursors serialize safely', () => {
  const filters = normalizeClientListFilters({
    search: `  ${'n'.repeat(100)}  `,
    pageSize: 999,
  });

  assert.equal(filters.search?.length, 80);
  assert.equal(filters.pageSize, 200);
  assert.equal(
    buildClientListPath(17, filters, 'opaque+cursor/='),
    `/api/v1/companies/17/clients?search=${'n'.repeat(80)}&status=active&pageSize=200&afterCursor=opaque%2Bcursor%2F%3D`,
  );
});

test('API clients retain UUID identity and public client number', () => {
  const mapped = mapClientSummary(firstClient);

  assert.equal(mapped.id, firstClient.clientId);
  assert.equal(mapped.clientNo, 42);
  assert.equal(mapped.cid, 42);
  assert.equal(mapped.cname, 'Northwind Cooling');
  assert.equal(mapped.name, 'Northwind Cooling');
  assert.equal(mapped.cphone, '0501234567');
  assert.equal(mapped.entityVersion, 'client-version-1');
});

test('overlapping cursor pages are merged without duplicate clients', () => {
  const clients = mergeClientSummaryPages([
    { items: [firstClient] },
    { items: [firstClient] },
  ]);

  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.id, firstClient.clientId);
});

test('client retries reuse one idempotency key until the action completes', () => {
  let sequence = 0;
  const keys = new StableClientActionKeys(() => `client-key-${++sequence}`);
  const first = keys.keyFor('update:client-1', 'version-1:same-payload');
  assert.equal(keys.keyFor('update:client-1', 'version-1:same-payload'), first);
  const changed = keys.keyFor('update:client-1', 'version-1:changed-payload');
  assert.notEqual(changed, first);
  keys.complete('update:client-1', changed);
  assert.notEqual(
    keys.keyFor('update:client-1', 'version-1:changed-payload'),
    changed,
  );
});

test('client list screen uses tenant-scoped Cloud Run pagination, not the legacy live cache', async () => {
  const [screen, hook, mutationHook, api, cacheActions, cacheFetchers] = await Promise.all([
    readFile(new URL('../modules/clients/screens/ClientBook.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/clients/lib/use-clients-infinite.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/clients/lib/use-client-mutations.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/clients/lib/clients-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../contexts/use-cache-client-actions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../contexts/cache-fetchers.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(screen, /useClientsInfinite/);
  assert.match(screen, /fetchNextPage/);
  assert.match(screen, /\.refetch\(\)/);
  assert.doesNotMatch(screen, /cachedClients|fetchClients\s*,/);
  assert.match(hook, /tenantQueryKey\(uid, companyId, 'clients'/);
  assert.match(hook, /useInfiniteQuery/);
  assert.match(hook, /previousKey\[1\] === uid/);
  assert.match(hook, /previousKey\[2\] === companyId/);
  assert.match(api, /requestApi/);
  assert.doesNotMatch(api, /readModelV1|MMKV|firebase/i);
  assert.match(screen, /useClientMutations/);
  assert.match(screen, /ClientCreateRequestSchema/);
  assert.match(screen, /ClientUpdateRequestSchema/);
  assert.match(screen, /ClientDeleteRequestSchema/);
  assert.match(screen, /entityVersion: editingClient\.entityVersion/);
  assert.match(screen, /StableClientActionKeys/);
  assert.doesNotMatch(screen, /await (?:addClient|updateClient|deleteClient)\(/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /method: 'PATCH'/);
  assert.match(api, /method: 'DELETE'/);
  assert.match(api, /idempotencyKey: input\.idempotencyKey/g);
  assert.match(mutationHook, /tenantQueryKey\(uid, companyId, 'clients'\)/);
  assert.match(mutationHook, /invalidateQueries/);
  assert.match(cacheActions, /createApiClient/);
  assert.match(cacheActions, /updateApiClient/);
  assert.match(cacheActions, /deleteOrArchiveApiClient/);
  assert.match(cacheActions, /status: 'active', pageSize: 200/);
  assert.match(cacheActions, /entityVersion/);
  assert.match(cacheActions, /StableClientActionKeys/);
  assert.match(cacheActions, /randomUUID\(\)/);
  assert.doesNotMatch(cacheActions, /httpsCallable|callHttpFunction|firebase/i);
  assert.match(cacheFetchers, /case 'clients':[\s\S]*fetchClientsPage/);
  assert.doesNotMatch(
    cacheFetchers.match(/case 'clients':[\s\S]*?case |case 'clients':[\s\S]*?default:/)?.[0] ?? '',
    /callHttpFunction/,
  );
});
