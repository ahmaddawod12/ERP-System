/**
 * useArchiveQuery.ts
 *
 * Custom hook that provides archive-aware month and date-range data queries.
 * Extracted from CacheContext to give it a single, focused responsibility:
 * resolving historical data across the three cache tiers:
 *
 *   Tier 1 (0–90 days)  — MMKV local in-memory cache
 *   Tier 2 (90-180 days) - backend/archive query (5-min MMKV TTL layer)
 *   Tier 3 (180+ days)  — Cloud Storage JSON archives
 */

import { useCallback } from 'react';
import {
  mmkvHelpers,
  CACHE_KEYS,
  CACHE_EXPIRY_MS,
  ARCHIVE_BOUNDARY_MS,
  TIER2_CACHE_TTL_MS,
  getCacheStartDate,
} from '../contexts/mmkv-storage';
import { fetchCompanyDocuments, fetchCompanyJobs } from '../utils/read-model';
import { downloadArchiveRun, findArchiveRun } from '../lib/api/archives';
import { logger } from '../utils/logger';

const ARCHIVE_READ_LIMIT = 1_000;

// ─── Internal helper ─────────────────────────────────────────────────────────

function normalizeTimestamp(value: any): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function isWithinRange(value: any, startMs: number, endMs: number, inclusiveEnd = true): boolean {
  const timestamp = normalizeTimestamp(value);
  return inclusiveEnd
    ? timestamp >= startMs && timestamp <= endMs
    : timestamp >= startMs && timestamp < endMs;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface ArchiveQueryDeps {
  getUserRole: () => string | null;
  getUid: () => string | null;
  getCompanyId: () => string | null;
  jobs: any[];
  companyJobs: any[];
  documents: any[];
}

export function useArchiveQuery({
  getUserRole,
  getUid,
  getCompanyId,
  jobs,
  companyJobs,
  documents,
}: ArchiveQueryDeps) {

  /**
   * Download a single archive month through the backend so role filtering
   * happens server-side before archived data reaches the device.
   */
  const fetchFromArchive = useCallback(async (
    companyId: string,
    year: number,
    month: number,
    dataType: string,
  ): Promise<any[]> => {
    const suffix = dataType === 'finishedJobs' ? 'j' : 'd';
    const archiveKey = `${year}-${month}-${suffix}`;
    const mmkvCacheKey = `archive_${companyId}_${archiveKey}`;

    const cached = mmkvHelpers.getObject<any[]>(mmkvCacheKey);
    if (cached !== null) {
      logger.debug(`Archive ${archiveKey} loaded from local cache (${(cached as any[]).length} docs)`);
      return cached;
    }

    logger.debug(`Fetching archive ${archiveKey} through backend`);

    try {
      const numericCompanyId = Number(companyId);
      if (!Number.isSafeInteger(numericCompanyId) || numericCompanyId <= 0) {
        return [];
      }
      const uid = getUid();
      if (!uid) return [];

      const archiveDataType = dataType === 'finishedJobs' ? 'jobs' : 'documents';
      const run = await findArchiveRun({
        uid,
        companyId: numericCompanyId,
        archiveKey,
        dataType: archiveDataType,
      });
      if (!run) return [];
      const result = await downloadArchiveRun({
        uid,
        companyId: numericCompanyId,
        archiveRunId: run.archiveRunId,
      });

      const docs = Array.isArray(result?.items) ? result.items : [];
      logger.debug(`Fetched archive ${archiveKey}: ${docs.length} docs`);
      mmkvHelpers.setObject(mmkvCacheKey, docs);
      return docs;
    } catch (error) {
      const message = (error as Error)?.message || '';
      if (message.includes('not-found') || message.includes('invalid') || message.includes('ARCHIVE_NOT_FOUND')) {
        logger.debug(`No archive found for ${archiveKey} or archive unavailable`);
        return [];
      }
      logger.warn(`Error fetching archive ${archiveKey}:`, error);
      return [];
    }
  }, [getUid]);

  /**
   * Get data for a specific calendar month using 3-tier smart caching.
   */
  const getDataForMonth = useCallback(async (
    monthDate: Date,
    dataType: string,
  ): Promise<any[]> => {
    const role = getUserRole();
    const uid = getUid();
    const companyId = getCompanyId();
    if (!companyId || !uid) return [];
    const safeRole = role || '';

    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const now = new Date();
    const cacheStartDate = new Date(now.getTime() - CACHE_EXPIRY_MS);
    const monthStartMs = monthStart.getTime();
    const monthEndMs = monthEnd.getTime();
    const cacheStartMs = cacheStartDate.getTime();

    let cachedData: any[] = [];
    if (dataType === 'finishedJobs') {
      const allJobs = safeRole === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter((j: any) => j.status === 'finished');
    } else if (dataType === 'documents') {
      cachedData = documents;
    }

    // Tier 1: fully within 90-day cache
    if (monthStartMs >= cacheStartMs && monthEndMs <= now.getTime()) {
      const dateField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
      return cachedData.filter((item: any) => {
        const d = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return d >= monthStartMs && d <= monthEndMs;
      });
    }

    // Tier 1 partial: month straddles the cache boundary
    if (monthEndMs >= cacheStartMs && monthStartMs < cacheStartMs) {
      const dateField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
      const cachedPart = cachedData.filter((item: any) => {
        const d = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return d >= cacheStartMs && d <= monthEndMs;
      });

      try {
        if (dataType === 'finishedJobs') {
          const jobsData = await fetchCompanyJobs(companyId, {
              limit: ARCHIVE_READ_LIMIT,
              status: 'finished',
              dateField: 'finishedAt',
              dateFrom: new Date(monthStartMs).toISOString(),
              dateTo: new Date(cacheStartMs - 1).toISOString(),
            });
          return [...cachedPart, ...jobsData];
        } else {
          const documentsData = await fetchCompanyDocuments(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            dateField: 'createdAt',
            dateFrom: new Date(monthStartMs).toISOString(),
            dateTo: new Date(cacheStartMs - 1).toISOString(),
          });
          return [...cachedPart, ...documentsData];
        }
      } catch (error) {
        logger.error('Error fetching partial month data:', error);
        return cachedPart;
      }
    }

    // Tier 2 / Tier 3: month is fully outside the 90-day cache
    const tier2Key = `${CACHE_KEYS.TIER2_CACHE_PREFIX}${dataType}_${monthDate.getFullYear()}_${monthDate.getMonth() + 1}`;
    const tier2 = mmkvHelpers.getObject<{ _ts: number; data: any[] }>(tier2Key);
    if (tier2 && tier2._ts && (Date.now() - tier2._ts) < TIER2_CACHE_TTL_MS) {
      return tier2.data;
    }

    try {
      let backendData: any[] = [];
      if (dataType === 'finishedJobs') {
        backendData = await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: 'finished',
            dateField: 'finishedAt',
            dateFrom: new Date(monthStartMs).toISOString(),
            dateTo: new Date(monthEndMs).toISOString(),
          });
      } else {
        backendData = await fetchCompanyDocuments(companyId, {
          limit: ARCHIVE_READ_LIMIT,
          dateField: 'createdAt',
          dateFrom: new Date(monthStartMs).toISOString(),
          dateTo: new Date(monthEndMs).toISOString(),
        });
      }

      if (backendData.length > 0) {
        mmkvHelpers.setObject(tier2Key, { data: backendData, _ts: Date.now() });
        return backendData;
      }

      // Backend returned nothing — check Storage archives for old months
      const archiveBoundary = new Date(now.getTime() - ARCHIVE_BOUNDARY_MS);
      if (monthEnd.getTime() < archiveBoundary.getTime()) {
        const archived = await fetchFromArchive(companyId, monthDate.getFullYear(), monthDate.getMonth() + 1, dataType);
        if (archived && archived.length > 0) return archived;
      }

      return [];
    } catch (error) {
      logger.error('Error fetching month data:', error);
      return [];
    }
  }, [getUserRole, getUid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  /**
   * Get data for an arbitrary date range with smart caching.
   * Used for "Last 7 days", "Last month" dashboard filters.
   */
  const getDataForDateRange = useCallback(async (
    startDate: Date,
    endDate: Date,
    dataType: string,
  ): Promise<any[]> => {
    const role = getUserRole();
    const uid = getUid();
    const companyId = getCompanyId();
    if (!companyId || !uid || !role) return [];
    const safeRole = role;
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const cacheStartMs = getCacheStartDate().getTime();

    let cachedData: any[] = [];
    if (dataType === 'finishedJobs') {
      const allJobs = safeRole === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter((j: any) => j.status === 'finished');
    } else if (dataType === 'documents') {
      cachedData = documents;
    } else if (dataType === 'pendingJobs') {
      const allJobs = safeRole === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter((j: any) => j.status === 'pending' || j.status === 'waiting');
    }

    const dateField = dataType === 'documents' ? 'createdAt' :
                      dataType === 'pendingJobs' ? 'createdAt' : 'finishedAt';

    if (startMs >= cacheStartMs) {
      return cachedData.filter((item: any) => {
        const d = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return d >= startMs && d <= endMs;
      });
    }

    const cachedPortion = cachedData.filter((item: any) => {
      const d = item[dateField] ? new Date(item[dateField]).getTime() : 0;
      return d >= cacheStartMs && d <= endMs;
    });

    try {
      let backendData: any[] = [];
      if (dataType === 'finishedJobs') {
        backendData = await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: 'finished',
            dateField: 'finishedAt',
            dateFrom: new Date(startMs).toISOString(),
            dateTo: new Date(cacheStartMs - 1).toISOString(),
          });
      } else if (dataType === 'documents') {
        backendData = await fetchCompanyDocuments(companyId, {
          limit: ARCHIVE_READ_LIMIT,
          dateField: 'createdAt',
          dateFrom: new Date(startMs).toISOString(),
          dateTo: new Date(cacheStartMs - 1).toISOString(),
        });
      } else if (dataType === 'pendingJobs') {
        backendData = await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: ['pending', 'waiting'],
            dateField: 'createdAt',
            dateFrom: new Date(startMs).toISOString(),
            dateTo: new Date(cacheStartMs - 1).toISOString(),
          });
      }

      if (backendData.length === 0 && dataType !== 'pendingJobs') {
        const archiveBoundary = new Date(Date.now() - ARCHIVE_BOUNDARY_MS);
        if (startMs < archiveBoundary.getTime()) {
          const archiveCheckEnd = new Date(Math.min(archiveBoundary.getTime(), cacheStartMs));
          const archivedDocs: any[] = [];
          let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          while (cursor < archiveCheckEnd) {
            const archived = await fetchFromArchive(companyId, cursor.getFullYear(), cursor.getMonth() + 1, dataType);
            if (archived && archived.length > 0) {
              const dField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
              let filtered = archived.filter((item: any) => {
                const d = item[dField] ? new Date(item[dField]).getTime() : 0;
                return d >= startMs && d <= endMs;
              });
              archivedDocs.push(...filtered);
            }
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          }
          if (archivedDocs.length > 0) return [...cachedPortion, ...archivedDocs];
        }
      }

      return [...cachedPortion, ...backendData];
    } catch (error) {
      logger.error('Error fetching data for date range:', error);
      return cachedPortion;
    }
  }, [getUserRole, getUid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  return { fetchFromArchive, getDataForMonth, getDataForDateRange };
}
