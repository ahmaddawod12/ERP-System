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
  db,
  functions,
  httpsCallable,
  collection,
  getDocs,
  query,
  where,
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

// ─── Internal helper ─────────────────────────────────────────────────────────

function buildJobMembershipConstraints(wid: string | number | null): any[] {
  const values = buildJobMembershipQueryValues(wid);
  if (values.length === 0) return [];
  return [
    values.length === 1
      ? where('wid', '==', values[0])
      : where('wid', 'in', values),
  ];
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
        let q: any;
        if (dataType === 'finishedJobs') {
          const jobsRef = collection(db, 'companies', companyId, 'jobs');
          if (roleUsesScopedJobAccess(safeRole)) {
            const constraints = buildJobMembershipConstraints(safeWid);
            if (constraints.length === 0) return cachedPart;
            q = (query as any)(jobsRef,
              where('status', '==', 'finished'),
              where('finishedAt', '>=', monthStart.toISOString()),
              where('finishedAt', '<', cacheStartDate.toISOString()),
              ...constraints,
            );
          } else {
            q = query(jobsRef,
              where('status', '==', 'finished'),
              where('finishedAt', '>=', monthStart.toISOString()),
              where('finishedAt', '<', cacheStartDate.toISOString()),
            );
          }
        } else {
          const documentsRef = collection(db, 'companies', companyId, 'documents');
          q = query(documentsRef,
            where('createdAt', '>=', monthStart.toISOString()),
            where('createdAt', '<', cacheStartDate.toISOString()),
          );
        }
        const snap = await getDocs(q);
        const fbData = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        return [...cachedPart, ...fbData];
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
      let q: any;
      if (dataType === 'finishedJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (roleUsesScopedJobAccess(safeRole)) {
          const constraints = buildJobMembershipConstraints(safeWid);
          if (constraints.length === 0) return [];
          q = (query as any)(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', monthStart.toISOString()),
            where('finishedAt', '<=', monthEnd.toISOString()),
            ...constraints,
          );
        } else {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', monthStart.toISOString()),
            where('finishedAt', '<=', monthEnd.toISOString()),
          );
        }
      } else {
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        q = query(documentsRef,
          where('createdAt', '>=', monthStart.toISOString()),
          where('createdAt', '<=', monthEnd.toISOString()),
        );
      }

      const snap = await getDocs(q);
      const fbData = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

      if (fbData.length > 0) {
        mmkvHelpers.setObject(tier2Key, { data: fbData, _ts: Date.now() });
        return fbData;
      }

      // Firestore returned nothing — check Storage archives for old months
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
      let q: any;
      if (dataType === 'finishedJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (roleUsesScopedJobAccess(safeRole)) {
          const constraints = buildJobMembershipConstraints(wid);
          if (constraints.length === 0) return cachedPortion;
          q = (query as any)(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', startDate.toISOString()),
            where('finishedAt', '<', getCacheStartDate().toISOString()),
            ...constraints,
          );
        } else {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', startDate.toISOString()),
            where('finishedAt', '<', getCacheStartDate().toISOString()),
          );
        }
      } else if (dataType === 'documents') {
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        q = query(documentsRef,
          where('createdAt', '>=', startDate.toISOString()),
          where('createdAt', '<', getCacheStartDate().toISOString()),
        );
      } else if (dataType === 'pendingJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (roleUsesScopedJobAccess(safeRole)) {
          const constraints = buildJobMembershipConstraints(wid);
          if (constraints.length === 0) return cachedPortion;
          q = (query as any)(jobsRef,
            where('status', 'in', ['pending', 'waiting']),
            where('createdAt', '>=', startDate.toISOString()),
            where('createdAt', '<', getCacheStartDate().toISOString()),
            ...constraints,
          );
        } else {
          q = query(jobsRef,
            where('status', 'in', ['pending', 'waiting']),
            where('createdAt', '>=', startDate.toISOString()),
            where('createdAt', '<', getCacheStartDate().toISOString()),
          );
        }
      }

      const snap = await getDocs(q);
      const fbData = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

      if (fbData.length === 0 && dataType !== 'pendingJobs') {
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

      return [...cachedPortion, ...fbData];
    } catch (error) {
      console.error('Error fetching data for date range:', error);
      return cachedPortion;
    }
  }, [getUserRole, getUid, getWid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  return { fetchFromArchive, getDataForMonth, getDataForDateRange };
}
