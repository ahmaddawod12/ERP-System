import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  ArchiveRunDownload,
  ArchiveRunSummary,
} from '@smart-job/api-contracts';

import {
  archiveManifestFingerprint,
  loadArchivePeriod,
  type ArchivePeriodCache,
  type ArchivePeriodDependencies,
} from '../lib/history/archive-period-model.ts';

function run(segment: number, generation = String(segment)): ArchiveRunSummary {
  return {
    archiveRunId: `00000000-0000-4000-8000-${String(segment).padStart(12, '0')}`,
    archiveKey: `2026-01-j-s${String(segment).padStart(6, '0')}`,
    dataType: 'jobs',
    status: 'deleted',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-02-01T00:00:00.000Z',
    segment,
    docCount: 1,
    deletedCount: 1,
    checksum: `checksum-${segment}`,
    storageGeneration: generation,
    createdAt: `2026-02-${String(segment).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: `2026-02-${String(segment).padStart(2, '0')}T00:01:00.000Z`,
  };
}

function jobDownload(summary: ArchiveRunSummary, id = String(summary.segment)): ArchiveRunDownload {
  return {
    archiveRunId: summary.archiveRunId,
    archiveKey: summary.archiveKey,
    dataType: 'jobs',
    checksum: summary.checksum,
    items: [{
      id,
      title: `Job ${id}`,
      description: '',
      status: 'finished',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:00:00.000Z',
      isCertificate: false,
      attachments: [],
      partsUsed: [],
    }],
  };
}

test('archive period downloads all ordered segments with concurrency capped at three', async () => {
  const runs = [run(1), run(2), run(3), run(4)];
  let active = 0;
  let maximumActive = 0;
  const dependencies: ArchivePeriodDependencies = {
    listRuns: async () => runs,
    downloadRun: async ({ archiveRunId }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const summary = runs.find((candidate) => candidate.archiveRunId === archiveRunId)!;
      return jobDownload(summary);
    },
    readCache: () => null,
    writeCache: () => undefined,
  };

  const result = await loadArchivePeriod({
    uid: 'viewer',
    companyId: 7,
    dataType: 'jobs',
    year: 2026,
    month: 1,
    dependencies,
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(result.items.map((item) => item.id), ['1', '2', '3', '4']);
  assert.equal(result.complete, true);
});

test('a late segment changes the manifest fingerprint and invalidates the cached month', async () => {
  const firstRuns = [run(1)];
  const lateRuns = [run(1), run(2)];
  let stored: ArchivePeriodCache<unknown> | null = {
    manifestFingerprint: archiveManifestFingerprint(firstRuns),
    items: [jobDownload(firstRuns[0]).items[0]],
    fetchedAt: Date.now(),
  };
  let downloads = 0;
  const dependencies: ArchivePeriodDependencies = {
    listRuns: async () => lateRuns,
    downloadRun: async ({ archiveRunId }) => {
      downloads += 1;
      const summary = lateRuns.find((candidate) => candidate.archiveRunId === archiveRunId)!;
      return jobDownload(summary);
    },
    readCache: () => stored as ArchivePeriodCache<never>,
    writeCache: (_key, value) => {
      stored = value;
    },
  };

  const result = await loadArchivePeriod({
    uid: 'viewer',
    companyId: 7,
    dataType: 'jobs',
    year: 2026,
    month: 1,
    dependencies,
  });

  assert.equal(downloads, 2);
  assert.deepEqual(result.items.map((item) => item.id), ['1', '2']);
  assert.equal(stored?.manifestFingerprint, archiveManifestFingerprint(lateRuns));
});

test('archive period cancellation is shared by all segment downloads', async () => {
  const controller = new AbortController();
  const runs = [run(1), run(2), run(3), run(4)];
  const dependencies: ArchivePeriodDependencies = {
    listRuns: async () => runs,
    downloadRun: async ({ archiveRunId, signal }) => {
      if (archiveRunId === runs[0].archiveRunId) controller.abort(new Error('cancelled'));
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (signal?.aborted) throw signal.reason;
      return jobDownload(runs[0]);
    },
    readCache: () => null,
    writeCache: () => undefined,
  };

  await assert.rejects(
    loadArchivePeriod({
      uid: 'viewer',
      companyId: 7,
      dataType: 'jobs',
      year: 2026,
      month: 1,
      signal: controller.signal,
      dependencies,
    }),
    /cancelled/,
  );
});
