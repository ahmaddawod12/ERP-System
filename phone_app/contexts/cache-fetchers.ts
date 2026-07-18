/**
 * cache-fetchers.ts
 *
 * Centralized read-model fetchers for CacheContext.
 * All slices now use the authenticated Cloud API with cursor pagination.
 */

import { fetchClientsPage } from '../modules/clients/lib/clients-api';
import {
  mapClientSummary,
  normalizeClientListFilters,
} from '../modules/clients/lib/client-list-model';
import { fetchWorkersPage } from '../modules/workers/lib/workers-api';
import { fetchInventoryPage } from '../modules/inventory/lib/inventory-api';
import { normalizeInventoryListFilters } from '../modules/inventory/lib/inventory-list-model';
import { fetchJobsPage as fetchJobsPageApi } from '../modules/jobs/lib/jobs-api';
import { fetchDocumentsPage as fetchDocumentsPageApi } from '../modules/documents/lib/documents-api';
import { fetchCompanyBootstrap, fetchViewerProfile, fetchBusinessProfile } from '../lib/api/client';
import { auth } from '../firebase';
import { mapJobSummary, normalizeJobListFilters } from '../modules/jobs/lib/job-list-model';
import {
  mapDocumentSummary,
  normalizeDocumentListFilters,
} from '../modules/documents/lib/document-history-model';
import { mapSubscriptionToCache, mapViewerProfileToCache } from './cache-api-model';

const MAX_DRAIN_PAGES = 50;

function numericCompanyId(companyId: string): number {
  const n = Number(companyId);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('A valid company is required');
  }
  return n;
}

async function drainPages<T>(
  fetchPage: (afterCursor: string | null) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_DRAIN_PAGES; i++) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function currentUid(): string {
  const uid = auth.currentUser?.uid?.trim();
  if (!uid) throw new Error('Authentication is required');
  return uid;
}

interface BootstrapPayload {
  profile: any | null;
  subscription: any | null;
  businessInfo: any | null;
  inventory: { parts: any[]; nextId: number; lastUpdated: string };
  companyInventory: { parts: any[]; nextId: number; lastUpdated: string };
  workers: any[] | Record<string, any>;
  clients: any[];
  clientsNextCursor?: string | null;
  jobs: any[];
  documents: any[];
  jobsNextCursor?: string | null;
  documentsNextCursor?: string | null;
}

function normalizeWorkersArray(workers: any[] | Record<string, any> | null | undefined) {
  if (!workers) return {};
  if (!Array.isArray(workers)) return workers;
  return workers.reduce((accumulator: Record<string, any>, worker: any) => {
    const wid = String(worker?.wid ?? worker?.memberNo ?? '');
    if (wid) {
      accumulator[wid] = worker;
    }
    return accumulator;
  }, {});
}

export async function fetchDataFromBackend(
  field: string,
  uid: string,
  companyId: string,
  role: string,
): Promise<any> {
  try {
    const numericId = companyId ? numericCompanyId(companyId) : 0;

    switch (field) {
      case 'profile': {
        if (!numericId) return null;
        const [profile, bootstrap] = await Promise.all([
          fetchViewerProfile(uid, numericId),
          fetchCompanyBootstrap(uid, numericId),
        ]);
        return mapViewerProfileToCache(profile, bootstrap);
      }

      case 'subscription': {
        if (!numericId) return null;
        const bootstrap = await fetchCompanyBootstrap(uid, numericId);
        return mapSubscriptionToCache(bootstrap);
      }

      case 'inventory': {
        if (!numericId) return [];
        const filters = normalizeInventoryListFilters({ pageSize: 200 });
        const items = await drainPages((cursor) =>
          fetchInventoryPage({
            uid,
            companyId: numericId,
            scope: 'member',
            filters,
            afterCursor: cursor,
          }),
        );
        return items.map((part: any) => ({ ...part, id: part.partId ?? part.id }));
      }

      case 'companyInventory': {
        if (!numericId) return [];
        const filters = normalizeInventoryListFilters({ pageSize: 200 });
        const items = await drainPages((cursor) =>
          fetchInventoryPage({
            uid,
            companyId: numericId,
            scope: 'company',
            filters,
            afterCursor: cursor,
          }),
        );
        return items.map((part: any) => ({ ...part, id: part.partId ?? part.id }));
      }

      case 'workers': {
        if (role !== 'manager' || !numericId) {
          return {};
        }
        const items = await drainPages((cursor) =>
          fetchWorkersPage({
            uid,
            companyId: numericId,
            afterCursor: cursor,
          }),
        );
        return normalizeWorkersArray(items);
      }

      case 'business_info': {
        if (!numericId) return null;
        const businessProfile = await fetchBusinessProfile(uid, numericId);
        return businessProfile;
      }

      case 'clients': {
        if (!numericId) return [];
        const page = await fetchClientsPage({
          uid,
          companyId: numericId,
          filters: normalizeClientListFilters({ status: 'active', pageSize: 200 }),
        });
        return page.items.map(mapClientSummary);
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching ${field} via Cloud API:`, error);
    return null;
  }
}

export async function fetchDocumentById(
  _docId: string,
  _uid: string,
  _companyId: string,
  _role: string,
): Promise<any | null> {
  return null;
}

export async function fetchAllRecentJobs(
  _uid: string,
  companyId: string,
  role: string,
): Promise<{ jobsData: any[]; documentsData: any[] }> {
  if (!companyId || role === 'dev') {
    return { jobsData: [], documentsData: [] };
  }
  return { jobsData: [], documentsData: [] };
}

export async function fetchCompanySyncState(uid: string, companyId: string): Promise<{
  jobsVersion: number;
  documentsVersion: number;
  clientsVersion: number;
  workersVersion: number;
  companyInventoryVersion: number;
  updatedAt: string;
}> {
  const bootstrap = await fetchCompanyBootstrap(uid, numericCompanyId(companyId));
  return bootstrap.syncState;
}

export async function fetchJobsPage(
  companyId: string,
  opts: {
    pageSize?: number;
    afterCursor?: string;
    signal?: AbortSignal;
    status?: string | string[];
    dateField?: 'createdAt' | 'updatedAt' | 'finishedAt' | 'dueAt';
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<{ items: any[]; nextCursor: string | null }> {
  try {
    const numericId = numericCompanyId(companyId);
    const statusArray = opts.status
      ? Array.isArray(opts.status) ? opts.status : [opts.status]
      : undefined;
    const filters = normalizeJobListFilters({
      pageSize: opts.pageSize ?? 50,
      ...(statusArray ? { status: statusArray as any } : {}),
      ...(opts.dateField ? { dateField: opts.dateField } : {}),
      ...(opts.dateFrom ? { dateFrom: opts.dateFrom } : {}),
      ...(opts.dateTo ? { dateTo: opts.dateTo } : {}),
    });
    const page = await fetchJobsPageApi({
      uid: currentUid(),
      companyId: numericId,
      filters,
      afterCursor: opts.afterCursor ?? null,
    });
    return { items: page.items.map(mapJobSummary), nextCursor: page.nextCursor };
  } catch (error) {
    console.error('Error fetching jobs page via Cloud API:', error);
    return { items: [], nextCursor: null };
  }
}

export async function fetchDocumentsPage(
  companyId: string,
  opts: {
    pageSize?: number;
    afterCursor?: string;
    signal?: AbortSignal;
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<{ items: any[]; nextCursor: string | null }> {
  try {
    const numericId = numericCompanyId(companyId);
    const filters = normalizeDocumentListFilters({
      pageSize: opts.pageSize ?? 50,
      ...(opts.dateFrom ? { dateFrom: opts.dateFrom } : {}),
      ...(opts.dateTo ? { dateTo: opts.dateTo } : {}),
    });
    const page = await fetchDocumentsPageApi({
      uid: currentUid(),
      companyId: numericId,
      filters,
      afterCursor: opts.afterCursor ?? null,
    });
    return { items: page.items.map(mapDocumentSummary), nextCursor: page.nextCursor };
  } catch (error) {
    console.error('Error fetching documents page via Cloud API:', error);
    return { items: [], nextCursor: null };
  }
}

export async function fetchUserSyncState(uid: string, companyId: string): Promise<{
  profile: number;
  inventory: number;
  subscription: number;
  updatedAt: string;
}> {
  const numericId = numericCompanyId(companyId);
  const [profile, bootstrap] = await Promise.all([
    fetchViewerProfile(uid, numericId),
    fetchCompanyBootstrap(uid, numericId),
  ]);
  const profileVersion = Date.parse(profile.updatedAt);
  const subscriptionVersion = Date.parse(bootstrap.syncState.updatedAt);
  return {
    profile: Number.isFinite(profileVersion) ? profileVersion : 0,
    inventory: bootstrap.syncState.companyInventoryVersion,
    subscription: Number.isFinite(subscriptionVersion) ? subscriptionVersion : 0,
    updatedAt: bootstrap.syncState.updatedAt,
  };
}
