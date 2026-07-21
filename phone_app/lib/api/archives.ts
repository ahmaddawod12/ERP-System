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
const MAX_ARCHIVE_LOOKUP_PAGES = 5;

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
  readonly afterCursor?: string | null;
  readonly signal?: AbortSignal;
}): Promise<ArchiveListPage> {
  const params = new URLSearchParams({
    dataType: input.dataType,
    pageSize: String(ARCHIVE_PAGE_SIZE),
  });
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

export async function findArchiveRun(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly archiveKey: string;
  readonly dataType: ArchiveDataType;
  readonly signal?: AbortSignal;
}): Promise<ArchiveRunSummary | null> {
  let afterCursor: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_ARCHIVE_LOOKUP_PAGES; pageNumber += 1) {
    const page = await fetchArchiveRunsPage({
      uid: input.uid,
      companyId: input.companyId,
      dataType: input.dataType,
      afterCursor,
      signal: input.signal,
    });
    const match = page.items.find((item) => item.archiveKey === input.archiveKey);
    if (match) return match;
    if (!page.nextCursor) return null;
    afterCursor = page.nextCursor;
  }
  return null;
}
