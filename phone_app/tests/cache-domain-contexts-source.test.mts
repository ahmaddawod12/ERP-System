import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), '..', ...segments), 'utf8');
}

test('mobile cache exposes focused memoized domain contexts without a combined facade', () => {
  const source = readRepoFile('phone_app', 'contexts', 'CacheContext.tsx');

  for (const contextName of [
    'CacheLifecycleContext',
    'JobsCacheContext',
    'DirectoryCacheContext',
    'InventoryCacheContext',
    'DocumentHistoryCacheContext',
  ]) {
    assert.match(source, new RegExp(`const ${contextName} =\\s*createContext`));
    assert.match(source, new RegExp(`${contextName}\\.Provider`));
  }

  assert.doesNotMatch(source, /export function useCache\s*\(/);
  assert.doesNotMatch(source, /<CacheContext\.Provider/);
  assert.match(source, /const jobsValue = useMemo<JobsCacheValue>/);
  assert.match(source, /const inventoryValue = useMemo<InventoryCacheValue>/);
  assert.match(source, /const documentHistoryValue = useMemo<DocumentHistoryCacheValue>/);
});

test('high-traffic screens consume only their required cache domains', () => {
  const details = readRepoFile('phone_app', 'components', 'domain', 'ViewJobDetails.tsx');
  const clientBook = readRepoFile('phone_app', 'modules', 'clients', 'screens', 'ClientBook.tsx');

  assert.match(details, /useCacheLifecycle/);
  assert.doesNotMatch(details, /useJobsCache|useDirectoryCache|useInventoryCache|useDocumentHistoryCache/);
  assert.match(clientBook, /useDocumentHistoryCache/);
  assert.doesNotMatch(clientBook, /useCacheLifecycle|useJobsCache|useDirectoryCache|useInventoryCache/);
});
