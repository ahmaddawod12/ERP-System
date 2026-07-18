import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cacheContextSource = fs.readFileSync(path.resolve(__dirname, '../contexts/CacheContext.tsx'), 'utf8');
const cacheFetcherSource = fs.readFileSync(path.resolve(__dirname, '../contexts/cache-fetchers.ts'), 'utf8');

test('mobile cache freshness uses Cloud API sync state instead of direct Firestore listeners', () => {
  assert.match(cacheFetcherSource, /fetchUserSyncState/);
  assert.match(cacheContextSource, /const fetchUserSyncState = useCallback/);
  assert.match(cacheContextSource, /await fetchUserSyncState\(uid, companyId\)/);
  assert.doesNotMatch(cacheContextSource, /onSnapshot\(userCacheRef/);
  assert.doesNotMatch(cacheContextSource, /await getDoc\(userCacheRef\)/);
  assert.doesNotMatch(cacheFetcherSource, /callHttpFunction/);
});
