/**
 * useArchiveQuery.ts
 *
 * Custom hook that provides archive-aware month and date-range data queries.
 * Extracted from CacheContext to give it a single, focused responsibility:
 * resolving historical data across the three cache tiers:
 *
 *   Tier 1 (0–90 days)  — MMKV local in-memory cache
 *   Tier 2 (90–180 days) — Firestore live query (5-min MMKV TTL layer)
 *   Tier 3 (180+ days)  — Cloud Storage JSON archives
 */

import { useCallback } from 'react';
import {
  functions,
  httpsCallable,
} from '../firebase';
import {
  mmkvHelpers,
  CACHE_KEYS,
  CACHE_EXPIRY_MS,
  ARCHIVE_BOUNDARY_MS,
  TIER2_CACHE_TTL_MS,
  getCacheStartDate,
} from '../contexts/mmkv-storage';
import {
  buildJobMembershipQueryValues,
  roleUsesScopedJobAccess,
} from '../contexts/job-membership';
import { fetchCompanyDocuments, fetchCompanyJobs } from '../utils/read-model';

const ARCHIVE_READ_LIMIT = 10_000;

// ─── Internal helper ─────────────────────────────────────────────────────────

function buildJobMembershipConstraints(wid: string | number | null): any[] {
  const values = buildJobMembershipQueryValues(wid);
  if (values.length === 0) return [];
  return values;
}

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

function filterJobsByMembership(jobs: any[], role: string, wid: string | number | null) {
  if (!roleUsesScopedJobAccess(role)) return jobs;
  const values = buildJobMembershipConstraints(wid);
  if (values.length === 0) return [];
  const normalized = new Set(values.map((value) => String(value)));
  return jobs.filter((job) => normalized.has(String(job?.wid ?? '')));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface ArchiveQueryDeps {
  getUserRole: () => string | null;
  getUid: () => string | null;
  getWid: () => string | null;
  getCompanyId: () => string | null;
  jobs: any[];
  companyJobs: any[];
  documents: any[];
}

export function useArchiveQuery({
  getUserRole,
  getUid,
  getWid,
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
      console.log(`?? Archive ${archiveKey} loaded from local cache (${(cached as any[]).length} docs)`);
      return cached;
    }

    console.log(`?? Fetching archive ${archiveKey} through backend`);

    try {
      const callable = httpsCallable(functions, 'fetchArchiveMonthV1');
      const result = await callable({
        companyId,
        year,
        month,
        dataType,
      }) as {
        data?: { success?: boolean; items?: any[] };
      };

      const docs = Array.isArray(result?.data?.items) ? result.data.items : [];
      console.log(`?? Fetched archive ${archiveKey}: ${docs.length} docs`);
      mmkvHelpers.setObject(mmkvCacheKey, docs);
      return docs;
    } catch (error) {
      const message = (error as Error)?.message || '';
      if (message.includes('not-found') || message.includes('invalid')) {
        console.log(`?? No archive found for ${archiveKey} or archive unavailable`);
        return [];
      }
      console.error(`? Error fetching archive ${archiveKey}:`, error);
      return [];
    }
  }, []);

  /**
   * Get data for a specific calendar month using 3-tier smart caching.
   */
  const getDataForMonth = useCallback(async (
    monthDate: Date,
    dataType: string,
  ): Promise<any[]> => {
    const role = getUserRole();
    const uid = getUid();
    const wid = getWid();
    const companyId = getCompanyId();
    if (!companyId || !uid) return [];
    const safeRole = role || '';
    const safeWid = wid || '';

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
          const jobsData = filterJobsByMembership(
            await fetchCompanyJobs(companyId, {
              limit: ARCHIVE_READ_LIMIT,
              status: 'finished',
              dateField: 'finishedAt',
              dateFrom: new Date(monthStartMs).toISOString(),
              dateTo: new Date(cacheStartMs - 1).toISOString(),
            }),
            safeRole,
            safeWid,
          );
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
        console.error('Error fetching partial month data:', error);
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
        backendData = filterJobsByMembership(
          await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: 'finished',
            dateField: 'finishedAt',
            dateFrom: new Date(monthStartMs).toISOString(),
            dateTo: new Date(monthEndMs).toISOString(),
          }),
          safeRole,
          safeWid,
        );
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
        if (archived && archived.length > 0) {
          if (dataType === 'finishedJobs' && safeRole !== 'manager') {
            return archived.filter((item: any) => String(item.wid) === wid);
          }
          if (dataType === 'documents' && safeRole !== 'manager') {
            return archived.filter((item: any) => item.createdByUid === uid);
          }
          return archived;
        }
      }

      return [];
    } catch (error) {
      console.error('Error fetching month data:', error);
      return [];
    }
  }, [getUserRole, getUid, getWid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

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
    const wid = getWid();
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
        backendData = filterJobsByMembership(
          await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: 'finished',
            dateField: 'finishedAt',
            dateFrom: new Date(startMs).toISOString(),
            dateTo: new Date(cacheStartMs - 1).toISOString(),
          }),
          safeRole,
          wid,
        );
      } else if (dataType === 'documents') {
        backendData = await fetchCompanyDocuments(companyId, {
          limit: ARCHIVE_READ_LIMIT,
          dateField: 'createdAt',
          dateFrom: new Date(startMs).toISOString(),
          dateTo: new Date(cacheStartMs - 1).toISOString(),
        });
      } else if (dataType === 'pendingJobs') {
        backendData = filterJobsByMembership(
          await fetchCompanyJobs(companyId, {
            limit: ARCHIVE_READ_LIMIT,
            status: ['pending', 'waiting'],
            dateField: 'createdAt',
            dateFrom: new Date(startMs).toISOString(),
            dateTo: new Date(cacheStartMs - 1).toISOString(),
          }),
          safeRole,
          wid,
        );
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
              if (safeRole !== 'manager') {
                const userField = dataType === 'finishedJobs' ? 'wid' : 'createdByUid';
                const userValue = dataType === 'finishedJobs' ? wid : uid;
                filtered = filtered.filter((item: any) => String(item[userField]) === userValue);
              }
              archivedDocs.push(...filtered);
            }
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          }
          if (archivedDocs.length > 0) return [...cachedPortion, ...archivedDocs];
        }
      }

      return [...cachedPortion, ...backendData];
    } catch (error) {
      console.error('Error fetching data for date range:', error);
      return cachedPortion;
    }
  }, [getUserRole, getUid, getWid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  return { fetchFromArchive, getDataForMonth, getDataForDateRange };
}
