import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('assigned jobs use a tenant-scoped infinite API query and retain cached pages', async () => {
  const [screen, hook] = await Promise.all([
    readSource('../modules/workers/screens/Workerjob.tsx'),
    readSource('../modules/jobs/lib/use-jobs-infinite.ts'),
  ]);

  assert.match(screen, /useJobsInfinite/);
  assert.match(screen, /jobsQuery\.fetchNextPage\(\)/);
  assert.match(screen, /entityVersion: job\.entityVersion/);
  assert.match(hook, /useInfiniteQuery/);
  assert.match(hook, /tenantQueryKey\(uid, companyId, 'jobs', filters\)/);
  assert.match(hook, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor/);
  assert.match(hook, /placeholderData:/);
  assert.match(hook, /previousKey\[1\] === uid/);
  assert.match(hook, /previousKey\[2\] === companyId/);
  assert.doesNotMatch(screen, /pendingWorkerJobs|fetchRecordById|httpsCallable|useCache/);
  assert.doesNotMatch(screen, /from ['"].*firebase['"]/);
});
