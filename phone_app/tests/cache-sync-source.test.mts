import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('company sync preserves role-specific job cache when only documents refresh', () => {
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');

  assert.match(cacheContext, /const getExistingJobsCacheForRole = useCallback/);
  assert.match(cacheContext, /role === 'manager'/);
  assert.match(cacheContext, /mmkvHelpers\.getObject\(CACHE_KEYS\.JOBS\)/);
  assert.match(cacheContext, /shouldFetchJobs \? jobsItems : getExistingJobsCacheForRole\(role\)/);
});
