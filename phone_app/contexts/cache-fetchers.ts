/**
 * cache-fetchers.ts
 *
 * Centralized read-model fetchers for CacheContext.
 * These no longer read business data directly from Firestore.
 */

import {
  mmkvHelpers,
  CACHE_KEYS,
} from './mmkv-storage';
import { callHttpFunction } from '../utils/httpFunctions';
import { logger } from '../utils/logger';

interface BootstrapPayload {
  profile: any | null;
  subscription: any | null;
  businessInfo: any | null;
  inventory: { parts: any[]; nextId: number; lastUpdated: string };
  companyInventory: { parts: any[]; nextId: number; lastUpdated: string };
  workers: any[] | Record<string, any>;
  clients: any[];
  jobs: any[];
  documents: any[];
  jobsNextCursor?: string | null;
  documentsNextCursor?: string | null;
}

interface CompanySyncStatePayload {
  jobsVersion: number;
  documentsVersion: number;
  clientsVersion: number;
  workersVersion: number;
  companyInventoryVersion: number;
  updatedAt?: string;
}

interface UserSyncStatePayload {
  profile: number;
  inventory: number;
  subscription: number;
  updatedAt?: string;
}

async function readBootstrap(companyId: string, includeCollections = false): Promise<BootstrapPayload> {
  return callHttpFunction<BootstrapPayload>('readModelV1', {
    kind: 'bootstrap',
    ...(companyId ? { companyId } : {}),
    includeCollections,
  });
}

function normalizeWorkersArray(workers: any[] | Record<string, any> | null | undefined) {
  if (!workers) return {};
  if (!Array.isArray(workers)) return workers;
  return workers.reduce((accumulator: Record<string, any>, worker: any) => {
    const wid = String(worker?.wid ?? '');
    if (wid) {
      accumulator[wid] = worker;
    }
    return accumulator;
  }, {});
}

export async function fetchDataFromFirebase(
  field: string,
  uid: string,
  companyId: string,
  role: string,
): Promise<any> {
  logger.debug(`[READ MODEL] Fetching ${field} from backend...`);

  try {
    switch (field) {
      case 'profile': {
        const bootstrap = await readBootstrap(companyId, false);
        return bootstrap.profile || null;
      }

      case 'subscription': {
        const bootstrap = await readBootstrap(companyId, false);
        return bootstrap.subscription || null;
      }

      case 'inventory': {
        const inventory = await callHttpFunction<{ parts: any[]; nextId: number; lastUpdated: string }>('readModelV1', {
          kind: 'inventory',
          ...(companyId ? { companyId } : {}),
          scope: 'user',
          targetUid: uid,
        });
        return Array.isArray(inventory?.parts) ? inventory.parts : [];
      }

      case 'companyInventory': {
        if (!companyId) return [];
        const inventory = await callHttpFunction<{ parts: any[]; nextId: number; lastUpdated: string }>('readModelV1', {
          kind: 'inventory',
          companyId,
          scope: 'company',
        });
        return Array.isArray(inventory?.parts) ? inventory.parts : [];
      }

      case 'workers': {
        if (role !== 'manager' || !companyId) {
          return {};
        }
        const workers = await callHttpFunction<any[]>('readModelV1', {
          kind: 'workers',
          companyId,
        });
        return normalizeWorkersArray(workers);
      }

      case 'business_info': {
        const bootstrap = await readBootstrap(companyId, false);
        return bootstrap.businessInfo || null;
      }

      case 'clients': {
        if (!companyId) return [];
        return callHttpFunction<any[]>('readModelV1', {
          kind: 'clients',
          companyId,
        });
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching ${field} from read model:`, error);
    return null;
  }
}

export async function fetchDocumentById(
  docId: string,
  _uid: string,
  companyId: string,
  _role: string,
): Promise<any | null> {
  logger.debug(`[READ MODEL] Fetching document ${docId} from backend...`);

  try {
    return await callHttpFunction<any | null>('readModelV1', {
      kind: 'recordById',
      companyId,
      recordId: docId,
    });
  } catch (error) {
    console.error(`Error fetching document ${docId}:`, error);
    return null;
  }
}

export async function fetchAllRecentJobs(
  _uid: string,
  companyId: string,
  role: string,
): Promise<{ jobsData: any[]; documentsData: any[] }> {
  if (role === 'dev') {
    logger.debug('Dev role: skipping all jobs/documents fetch (early return)');
    return { jobsData: [], documentsData: [] };
  }

  logger.debug('[READ MODEL] Fetching bootstrap jobs/documents from backend...');

  try {
    const bootstrap = await readBootstrap(companyId, true);
    return {
      jobsData: Array.isArray(bootstrap.jobs) ? bootstrap.jobs : [],
      documentsData: Array.isArray(bootstrap.documents) ? bootstrap.documents : [],
    };
  } catch (error) {
    console.error('Error fetching bootstrap jobs/documents:', error);
    return { jobsData: [], documentsData: [] };
  }
}

export async function fetchCompanySyncState(companyId: string): Promise<CompanySyncStatePayload> {
  if (!companyId) {
    return {
      jobsVersion: 0,
      documentsVersion: 0,
      clientsVersion: 0,
      workersVersion: 0,
      companyInventoryVersion: 0,
      updatedAt: '',
    };
  }

  try {
    return await callHttpFunction<CompanySyncStatePayload>('readModelV1', {
      kind: 'companySyncState',
      companyId,
    });
  } catch (error) {
    console.error('Error fetching company sync state from read model:', error);
    return {
      jobsVersion: 0,
      documentsVersion: 0,
      clientsVersion: 0,
      workersVersion: 0,
      companyInventoryVersion: 0,
      updatedAt: '',
    };
  }
}

/**
 * Fetches one page of jobs using cursor-based pagination.
 */
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
    const body: Record<string, unknown> = {
      kind: 'jobs',
      companyId,
      pageSize: opts.pageSize ?? 50,
    };
    if (opts.afterCursor) body.afterCursor = opts.afterCursor;
    if (opts.status) body.status = opts.status;
    if (opts.dateField) body.dateField = opts.dateField;
    if (opts.dateFrom) body.dateFrom = opts.dateFrom;
    if (opts.dateTo) body.dateTo = opts.dateTo;
    return await callHttpFunction<{ items: any[]; nextCursor: string | null }>('readModelV1', body, { signal: opts.signal });
  } catch (error) {
    console.error('Error fetching jobs page:', error);
    return { items: [], nextCursor: null };
  }
}

/**
 * Fetches one page of documents using cursor-based pagination.
 */
export async function fetchDocumentsPage(
  companyId: string,
  opts: {
    pageSize?: number;
    afterCursor?: string;
    signal?: AbortSignal;
    dateField?: 'createdAt' | 'updatedAt' | 'documentDate';
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<{ items: any[]; nextCursor: string | null }> {
  try {
    const body: Record<string, unknown> = {
      kind: 'documents',
      companyId,
      pageSize: opts.pageSize ?? 50,
    };
    if (opts.afterCursor) body.afterCursor = opts.afterCursor;
    if (opts.dateField) body.dateField = opts.dateField;
    if (opts.dateFrom) body.dateFrom = opts.dateFrom;
    if (opts.dateTo) body.dateTo = opts.dateTo;
    return await callHttpFunction<{ items: any[]; nextCursor: string | null }>('readModelV1', body, { signal: opts.signal });
  } catch (error) {
    console.error('Error fetching documents page:', error);
    return { items: [], nextCursor: null };
  }
}

export async function fetchUserSyncState(): Promise<UserSyncStatePayload> {
  try {
    return await callHttpFunction<UserSyncStatePayload>('readModelV1', {
      kind: 'userSyncState',
    });
  } catch (error) {
    console.error('Error fetching user sync state from read model:', error);
    return {
      profile: 0,
      inventory: 0,
      subscription: 0,
      updatedAt: '',
    };
  }
}
