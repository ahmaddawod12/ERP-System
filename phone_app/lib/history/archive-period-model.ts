import {
  ArchivedDocumentRecordSchema,
  ArchivedJobRecordSchema,
  type ArchiveDataType,
  type ArchiveRunDownload,
  type ArchiveRunSummary,
  type ArchivedDocumentRecord,
  type ArchivedJobRecord,
} from '@smart-job/api-contracts';

import type { HistoricalQueryResult } from '../../types';

export type HistoricalArchiveRecord = ArchivedJobRecord | ArchivedDocumentRecord;

export interface ArchivePeriodCache<T> {
  readonly manifestFingerprint: string;
  readonly items: readonly T[];
  readonly fetchedAt: number;
}

export interface ArchivePeriodDependencies {
  readonly listRuns: (input: {
    readonly uid: string;
    readonly companyId: number;
    readonly dataType: ArchiveDataType;
    readonly year: number;
    readonly month: number;
    readonly signal?: AbortSignal;
  }) => Promise<readonly ArchiveRunSummary[]>;
  readonly downloadRun: (input: {
    readonly uid: string;
    readonly companyId: number;
    readonly archiveRunId: string;
    readonly signal?: AbortSignal;
  }) => Promise<ArchiveRunDownload>;
  readonly readCache: <T>(key: string) => ArchivePeriodCache<T> | null;
  readonly writeCache: <T>(key: string, value: ArchivePeriodCache<T>) => void;
}

function cacheKey(companyId: number, dataType: ArchiveDataType, year: number, month: number): string {
  return `archive_period_${companyId}_${dataType}_${year}_${String(month).padStart(2, '0')}`;
}

export function archiveManifestFingerprint(runs: readonly ArchiveRunSummary[]): string {
  return [...runs]
    .sort((left, right) =>
      left.segment - right.segment || left.archiveRunId.localeCompare(right.archiveRunId))
    .map((run) => [
      run.archiveRunId,
      run.storageGeneration ?? '-',
      run.checksum ?? '-',
      run.status,
    ].join(':'))
    .join('|');
}

function canonicalId(record: HistoricalArchiveRecord): string {
  return 'documentId' in record ? `document:${record.documentId}` : `job:${record.id}`;
}

function parseDownload(download: ArchiveRunDownload): HistoricalArchiveRecord[] {
  const schema = download.dataType === 'jobs'
    ? ArchivedJobRecordSchema
    : ArchivedDocumentRecordSchema;
  return download.items.map((item) => schema.parse(item));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error('Archive download was cancelled');
      }
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

export async function loadArchivePeriod(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly dataType: ArchiveDataType;
  readonly year: number;
  readonly month: number;
  readonly signal?: AbortSignal;
  readonly dependencies: ArchivePeriodDependencies;
}): Promise<HistoricalQueryResult<HistoricalArchiveRecord>> {
  const runs = await input.dependencies.listRuns(input);
  const fingerprint = archiveManifestFingerprint(runs);
  const key = cacheKey(input.companyId, input.dataType, input.year, input.month);
  const cached = input.dependencies.readCache<HistoricalArchiveRecord>(key);

  if (cached?.manifestFingerprint === fingerprint) {
    return {
      items: cached.items,
      complete: runs.every((run) => run.status === 'uploaded_not_deleted' || run.status === 'deleted'),
      nextCursor: null,
      source: 'cache',
    };
  }

  const readyRuns = runs.filter(
    (run) => run.status === 'uploaded_not_deleted' || run.status === 'deleted',
  );
  const downloads = await mapWithConcurrency(
    readyRuns,
    3,
    input.signal,
    (run) => input.dependencies.downloadRun({
      uid: input.uid,
      companyId: input.companyId,
      archiveRunId: run.archiveRunId,
      signal: input.signal,
    }),
  );

  const seen = new Set<string>();
  const items: HistoricalArchiveRecord[] = [];
  for (const download of downloads) {
    for (const record of parseDownload(download)) {
      const id = canonicalId(record);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(record);
    }
  }

  const complete = readyRuns.length === runs.length;
  if (complete) {
    input.dependencies.writeCache(key, {
      manifestFingerprint: fingerprint,
      items,
      fetchedAt: Date.now(),
    });
  }

  return { items, complete, nextCursor: null, source: 'archive' };
}
