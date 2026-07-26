/**
 * Resolves historical jobs and documents across the in-memory cache, bounded
 * live API pages, and immutable archive segments. Every result reports whether
 * the requested range is complete; callers must never present a partial page
 * set as complete history.
 */

import { useCallback } from 'react';

import type { AppDocument, HistoricalQueryResult, Job } from '../types';
import {
  ARCHIVE_BOUNDARY_MS,
  CACHE_EXPIRY_MS,
  CACHE_KEYS,
  TIER2_CACHE_TTL_MS,
  getCacheStartDate,
  mmkvHelpers,
} from '../contexts/mmkv-storage';
import {
  fetchCompanyDocumentsPage,
  fetchCompanyJobsPage,
} from '../utils/read-model';
import {
  loadArchivePeriod,
  type HistoricalArchiveRecord,
} from '../lib/history/archive-period';
import {
  mapArchivedDocument,
  mapArchivedJob,
} from '../lib/history/historical-records';
import { logger } from '../utils/logger';

export type HistoricalDataType = 'finishedJobs' | 'documents' | 'pendingJobs';
export type HistoricalRecord = Job | AppDocument;

export interface ArchiveQueryDeps {
  getUserRole: () => string | null;
  getUid: () => string | null;
  getCompanyId: () => string | null;
  jobs: readonly Job[];
  companyJobs: readonly Job[];
  documents: readonly AppDocument[];
}

interface TimedHistoricalCache {
  readonly fetchedAt: number;
  readonly result: HistoricalQueryResult<HistoricalRecord>;
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as { readonly toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      const time = (toDate as () => Date)().getTime();
      return Number.isFinite(time) ? time : 0;
    }
  }
  return 0;
}

function itemDate(item: HistoricalRecord, dataType: HistoricalDataType): number {
  if (dataType === 'documents') return timestamp((item as AppDocument).createdAt);
  if (dataType === 'pendingJobs') return timestamp((item as Job).createdAt);
  return timestamp((item as Job).finishedAt);
}

function inRange(
  items: readonly HistoricalRecord[],
  dataType: HistoricalDataType,
  startMs: number,
  endMs: number,
): HistoricalRecord[] {
  return items.filter((item) => {
    const value = itemDate(item, dataType);
    return value >= startMs && value <= endMs;
  });
}

function mergeUnique(
  ...collections: readonly (readonly HistoricalRecord[])[]
): HistoricalRecord[] {
  const seen = new Set<string>();
  const merged: HistoricalRecord[] = [];
  for (const collection of collections) {
    for (const item of collection) {
      const prefix = 'type' in item ? 'document' : 'job';
      const id = `${prefix}:${item.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

function mapArchiveRecord(record: HistoricalArchiveRecord): HistoricalRecord {
  return 'documentId' in record
    ? mapArchivedDocument(record)
    : mapArchivedJob(record);
}

async function readLiveHistory(input: {
  readonly companyId: string;
  readonly dataType: HistoricalDataType;
  readonly start: Date;
  readonly end: Date;
}): Promise<HistoricalQueryResult<HistoricalRecord>> {
  const items: HistoricalRecord[] = [];
  let afterCursor: string | null = null;
  const seenCursors = new Set<string>();

  try {
    do {
      const page: {
        readonly items: readonly HistoricalRecord[];
        readonly nextCursor: string | null;
      } = input.dataType === 'documents'
        ? await fetchCompanyDocumentsPage(input.companyId, {
            pageSize: 200,
            dateFrom: input.start.toISOString(),
            dateTo: input.end.toISOString(),
            afterCursor,
          })
        : await fetchCompanyJobsPage(input.companyId, {
            pageSize: 200,
            status: input.dataType === 'pendingJobs'
              ? ['pending', 'waiting']
              : 'finished',
            dateField: input.dataType === 'pendingJobs' ? 'createdAt' : 'finishedAt',
            dateFrom: input.start.toISOString(),
            dateTo: input.end.toISOString(),
            afterCursor,
          });

      items.push(...page.items);
      const nextCursor: string | null = page.nextCursor;
      if (!nextCursor) {
        return { items, complete: true, nextCursor: null, source: 'live' };
      }
      if (seenCursors.has(nextCursor)) {
        return { items, complete: false, nextCursor, source: 'live' };
      }
      seenCursors.add(nextCursor);
      afterCursor = nextCursor;
    } while (afterCursor);
  } catch (error) {
    logger.warn('Historical live pagination stopped before completion', {
      fetchedCount: items.length,
      dataType: input.dataType,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { items, complete: false, nextCursor: afterCursor, source: 'live' };
  }

  return { items, complete: true, nextCursor: null, source: 'live' };
}

export function useArchiveQuery({
  getUserRole,
  getUid,
  getCompanyId,
  jobs,
  companyJobs,
  documents,
}: ArchiveQueryDeps) {
  const fetchFromArchive = useCallback(async (
    companyId: string,
    year: number,
    month: number,
    dataType: Exclude<HistoricalDataType, 'pendingJobs'>,
    signal?: AbortSignal,
  ): Promise<HistoricalQueryResult<HistoricalRecord>> => {
    const numericCompanyId = Number(companyId);
    const uid = getUid();
    if (!Number.isSafeInteger(numericCompanyId) || numericCompanyId <= 0 || !uid) {
      return { items: [], complete: false, nextCursor: null, source: 'archive' };
    }

    try {
      const result = await loadArchivePeriod({
        uid,
        companyId: numericCompanyId,
        dataType: dataType === 'finishedJobs' ? 'jobs' : 'documents',
        year,
        month,
        signal,
      });
      return { ...result, items: result.items.map(mapArchiveRecord) };
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn('Archive period could not be loaded', {
        year,
        month,
        dataType,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { items: [], complete: false, nextCursor: null, source: 'archive' };
    }
  }, [getUid]);

  const getDataForMonth = useCallback(async (
    monthDate: Date,
    dataType: Exclude<HistoricalDataType, 'pendingJobs'>,
  ): Promise<HistoricalQueryResult<HistoricalRecord>> => {
    const uid = getUid();
    const companyId = getCompanyId();
    if (!companyId || !uid) {
      return { items: [], complete: false, nextCursor: null, source: 'cache' };
    }

    const role = getUserRole() ?? '';
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const now = Date.now();
    const cacheStartMs = now - CACHE_EXPIRY_MS;
    const localItems: readonly HistoricalRecord[] = dataType === 'documents'
      ? documents
      : (role === 'manager' ? companyJobs : jobs).filter((job) => job.status === 'finished');
    const localRangeItems = inRange(localItems, dataType, monthStart.getTime(), monthEnd.getTime());

    if (monthStart.getTime() >= cacheStartMs) {
      return { items: localRangeItems, complete: true, nextCursor: null, source: 'cache' };
    }

    const tier2Key = `${CACHE_KEYS.TIER2_CACHE_PREFIX}${dataType}_${monthDate.getFullYear()}_${monthDate.getMonth() + 1}`;
    const cached = mmkvHelpers.getObject<TimedHistoricalCache>(tier2Key);
    if (cached && Date.now() - cached.fetchedAt < TIER2_CACHE_TTL_MS) {
      return cached.result;
    }

    const liveEnd = new Date(Math.min(monthEnd.getTime(), cacheStartMs - 1));
    const live = await readLiveHistory({
      companyId,
      dataType,
      start: monthStart,
      end: liveEnd,
    });
    const combinedLive = mergeUnique(localRangeItems, live.items);
    if (!live.complete || live.items.length > 0) {
      const result: HistoricalQueryResult<HistoricalRecord> = {
        items: combinedLive,
        complete: live.complete,
        nextCursor: live.nextCursor,
        source: localRangeItems.length > 0 ? 'mixed' : 'live',
      };
      if (result.complete) {
        mmkvHelpers.setObject(tier2Key, { fetchedAt: Date.now(), result });
      }
      return result;
    }

    if (monthEnd.getTime() < now - ARCHIVE_BOUNDARY_MS) {
      const archived = await fetchFromArchive(
        companyId,
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        dataType,
      );
      const result: HistoricalQueryResult<HistoricalRecord> = {
        ...archived,
        items: mergeUnique(localRangeItems, archived.items),
        source: localRangeItems.length > 0 ? 'mixed' : archived.source,
      };
      return result;
    }

    return { items: combinedLive, complete: true, nextCursor: null, source: 'live' };
  }, [
    companyJobs,
    documents,
    fetchFromArchive,
    getCompanyId,
    getUid,
    getUserRole,
    jobs,
  ]);

  const getDataForDateRange = useCallback(async (
    startDate: Date,
    endDate: Date,
    dataType: HistoricalDataType,
  ): Promise<HistoricalQueryResult<HistoricalRecord>> => {
    const role = getUserRole();
    const uid = getUid();
    const companyId = getCompanyId();
    if (!companyId || !uid || !role) {
      return { items: [], complete: false, nextCursor: null, source: 'cache' };
    }

    const cacheStartMs = getCacheStartDate().getTime();
    const localItems: readonly HistoricalRecord[] = dataType === 'documents'
      ? documents
      : (role === 'manager' ? companyJobs : jobs).filter((job) => (
          dataType === 'finishedJobs'
            ? job.status === 'finished'
            : job.status === 'pending' || job.status === 'waiting'
        ));
    const localRangeItems = inRange(localItems, dataType, startDate.getTime(), endDate.getTime());

    if (startDate.getTime() >= cacheStartMs) {
      return { items: localRangeItems, complete: true, nextCursor: null, source: 'cache' };
    }

    const live = await readLiveHistory({
      companyId,
      dataType,
      start: startDate,
      end: new Date(Math.min(endDate.getTime(), cacheStartMs - 1)),
    });
    if (!live.complete || live.items.length > 0 || dataType === 'pendingJobs') {
      return {
        items: mergeUnique(localRangeItems, live.items),
        complete: live.complete,
        nextCursor: live.nextCursor,
        source: localRangeItems.length > 0 ? 'mixed' : 'live',
      };
    }

    const archiveBoundaryMs = Date.now() - ARCHIVE_BOUNDARY_MS;
    if (startDate.getTime() >= archiveBoundaryMs) {
      return {
        items: mergeUnique(localRangeItems, live.items),
        complete: true,
        nextCursor: null,
        source: localRangeItems.length > 0 ? 'mixed' : 'live',
      };
    }

    const archivedItems: HistoricalRecord[] = [];
    let complete = true;
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const archiveEnd = Math.min(endDate.getTime(), archiveBoundaryMs);
    while (cursor.getTime() <= archiveEnd) {
      const archiveResult = await fetchFromArchive(
        companyId,
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        dataType,
      );
      archivedItems.push(...inRange(
        archiveResult.items,
        dataType,
        startDate.getTime(),
        endDate.getTime(),
      ));
      complete = complete && archiveResult.complete;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return {
      items: mergeUnique(localRangeItems, archivedItems),
      complete,
      nextCursor: null,
      source: localRangeItems.length > 0 ? 'mixed' : 'archive',
    };
  }, [
    companyJobs,
    documents,
    fetchFromArchive,
    getCompanyId,
    getUid,
    getUserRole,
    jobs,
  ]);

  return { fetchFromArchive, getDataForMonth, getDataForDateRange };
}
