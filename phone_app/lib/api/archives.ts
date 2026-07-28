import {
  ArchiveListPageSchema,
  ArchiveRunDownloadSchema,
  type ArchiveDataType,
  type ArchiveListPage,
  type ArchiveRunDownload,
  type ArchiveRunSummary,
} from '@smart-job/api-contracts';

import { requestApi } from './client';

const ARCHIVE_PAGE_SIZE = 200;

function companyArchivesPath(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to read archives');
  }
  return `/api/v1/companies/${companyId}/archives`;
}

export function fetchArchiveRunsPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly dataType: ArchiveDataType;
  readonly year?: number;
  readonly month?: number;
  readonly afterCursor?: string | null;
  readonly signal?: AbortSignal;
}): Promise<ArchiveListPage> {
  const params = new URLSearchParams({
    dataType: input.dataType,
    pageSize: String(ARCHIVE_PAGE_SIZE),
  });
  if (input.year !== undefined) params.set('year', String(input.year));
  if (input.month !== undefined) params.set('month', String(input.month));
  if (input.afterCursor) params.set('afterCursor', input.afterCursor);
  return requestApi(
    `${companyArchivesPath(input.companyId)}?${params.toString()}`,
    ArchiveListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export function downloadArchiveRun(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly archiveRunId: string;
  readonly signal?: AbortSignal;
}): Promise<ArchiveRunDownload> {
  const archiveRunId = input.archiveRunId.trim();
  if (!archiveRunId) throw new Error('A valid archive run is required');
  return requestApi(
    `${companyArchivesPath(input.companyId)}/${encodeURIComponent(archiveRunId)}/download`,
    ArchiveRunDownloadSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export async function fetchArchivePeriodRuns(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly dataType: ArchiveDataType;
  readonly year: number;
  readonly month: number;
  readonly signal?: AbortSignal;
}): Promise<readonly ArchiveRunSummary[]> {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new Error('A valid archive year is required');
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error('A valid archive month is required');
  }

  let afterCursor: string | null = null;
  const runs: ArchiveRunSummary[] = [];
  do {
    const page = await fetchArchiveRunsPage({
      uid: input.uid,
      companyId: input.companyId,
      dataType: input.dataType,
      year: input.year,
      month: input.month,
      afterCursor,
      signal: input.signal,
    });
    runs.push(...page.items);
    afterCursor = page.nextCursor;
  } while (afterCursor);

  return runs.sort((left, right) =>
    left.segment - right.segment
    || left.createdAt.localeCompare(right.createdAt)
    || left.archiveRunId.localeCompare(right.archiveRunId));
}
