/**
 * CacheContext.js - MMKV-based caching with summary-version sync
 * 
 * Cache Structure (backend company sync state):
 * - company_sync_state:
 *   { jobsVersion, documentsVersion, clientsVersion, workersVersion, companyInventoryVersion, updatedAt }
 * 
 * Sync Strategy:
 * - Poll backend sync summaries
 * - On version mismatch: cursor re-fetch of the changed collection within the active cache window
 * - Constant-size version state, no per-record payload fields
 * 
 * Unified Jobs Collection:
 * - All jobs live in SQL `jobs`
 * - Status field distinguishes: pending, waiting, finished, denied
 * - No p_/f_ prefixes on IDs; public job numbers come from SQL counters
 * 
 * Cache Duration: 90 days for finished jobs and documents
 * 
 * Listener Setup by Role:
 * - Manager: 2 listeners (user cache: profile/inventory, company cache: all version fields)
 * - Worker: 1 listener (user cache: profile/inventory) + 1 company cache listener (jobsVersion)
 * - User: 1 listener (user cache: profile/inventory) + 1 company cache listener
 * - Basic: 1 listener (user cache: profile) + 1 company cache listener (documentsVersion/clientsVersion)
 * - Dev: no listeners
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { auth } from '../lib/auth/transport';
import { useAppStateListener } from '../hooks/useAppStateListener';
import type { CacheContextValue, UserProfile, Job, AppDocument, Client, Worker, InventoryPart, Subscription, CacheVersions, RoleTitle, Maybe } from '../types';
import { safeJsonParse } from '../utils/helpers';
import { logger } from '../utils/logger';
import {
  fetchDataFromBackend as _fetchDataFromBackend,
  fetchCompanySyncState as _fetchCompanySyncState,
  fetchUserSyncState as _fetchUserSyncState,
  fetchJobsPage as _fetchJobsPage,
  fetchDocumentsPage as _fetchDocumentsPage,
} from './cache-fetchers';
import { useArchiveQuery } from '../hooks/useArchiveQuery';
import { useCacheJobActions } from './use-cache-job-actions';
import { useCacheWorkerActions } from './use-cache-worker-actions';
import { useCacheClientActions } from './use-cache-client-actions';

// Extracted MMKV utilities (zero React dependencies)
import {
  storage,
  CACHE_KEYS,
  CACHE_EXPIRY_MS,
  ARCHIVE_BOUNDARY_MS,
  TIER2_CACHE_TTL_MS,
  setMmkvScope,
  scopedKey,
  mmkvHelpers,
  isWithinCacheRange,
  getCacheStartDate,
  getDocumentType,
} from './mmkv-storage';
import {
  isProfileCacheOwnedByUser,
  isScopedCacheCompanyMismatch,
  resolveCachedSessionIdentity,
} from './cache-identity';
import { roleUsesScopedJobAccess } from './job-membership';
import { getNextCompanySyncPollIntervalMs } from './company-sync-poll';

// Create context
const CacheContext = createContext<CacheContextValue | null>(null);

// Custom hook to use cache
export const useCache = (): CacheContextValue => {
  const context = useContext(CacheContext);
  if (!context) {
    throw new Error('useCache must be used within a CacheProvider');
  }
  return context;
};

export function CacheProvider({ children }: { children: ReactNode }) {
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<Maybe<UserProfile>>(null);
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<Record<string, Worker>>({});
  const [companyJobs, setCompanyJobs] = useState<Job[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [subscription, setSubscription] = useState<Maybe<Subscription>>(null);
  const [companyInventory, setCompanyInventory] = useState<InventoryPart[]>([]);
  const [cacheVersions, setCacheVersions] = useState<CacheVersions>({});
  const [companyVersions, setCompanyVersions] = useState<CacheVersions>({});

  const resetCacheState = useCallback(() => {
    setProfile(null);
    setInventory([]);
    setJobs([]);
    setWorkers({});
    setCompanyJobs([]);
    setDocuments([]);
    setClients([]);
    setSubscription(null);
    setCompanyInventory([]);
    setCacheVersions({});
    setCompanyVersions({});
    setIsInitialized(false);
  }, []);
  
  // Refs for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const companyUnsubscribeRef = useRef<(() => void) | null>(null);
  const inventoryUnsubscribeRef = useRef<(() => void) | null>(null); // I9: Company inventory listener
  const listenersActiveRef = useRef(false); // Track if listeners are currently active
  const userPollInFlightRef = useRef(false);
  const companyPollInFlightRef = useRef(false);
  const userPollIdleCountRef = useRef(0);
  const companyPollIdleCountRef = useRef(0);
  const resumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Get current user info from cache (canonical names)
  const getUid = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.UID), []);
  const getUserRole = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.USER_ROLE), []);
  const getCompanyId = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.COMPANY_ID), []);
  const getWid = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.USER_WID), []);

  /**
   * Pause backend sync polling when app is backgrounded.
   */
  const pauseListeners = useCallback(() => {
    if (!listenersActiveRef.current) return; // Already paused
    
    logger.debug('[CACHE] Pausing backend sync polling to prevent background reads');
    
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (companyUnsubscribeRef.current) {
      companyUnsubscribeRef.current();
      companyUnsubscribeRef.current = null;
    }
    if (inventoryUnsubscribeRef.current) {
      inventoryUnsubscribeRef.current();
      inventoryUnsubscribeRef.current = null;
    }
    
    listenersActiveRef.current = false;
  }, []);

  /**
   * Resume backend sync polling when app becomes active.
   */
  const resumeListeners = useCallback(() => {
    if (listenersActiveRef.current) return; // Already active
    
    logger.debug('[CACHE] Resuming backend sync polling');
    
    const uid = getUid();
    const role = getUserRole();
    const companyId = getCompanyId();
    
    if (uid && role) {
      setupCacheListeners(uid, role, companyId);
      listenersActiveRef.current = true;
    }
  }, [getUid, getUserRole, getCompanyId]); // Will define setupCacheListeners below

  /**
   * Debounced version — prevents poll storms when the OS fires multiple
   * active/inactive events in quick succession (e.g. incoming call overlay).
   */
  const resumeListenersDebounced = useCallback(() => {
    if (resumeDebounceRef.current) return; // Already scheduled
    resumeDebounceRef.current = setTimeout(() => {
      resumeDebounceRef.current = null;
      resumeListeners();
    }, 350);
  }, [resumeListeners]);

  // Android lifecycle: Pause listeners when app backgrounds, resume when active
  useAppStateListener({
    onActive: () => {
      resumeListenersDebounced();
    },
    onBackground: () => {
      if (resumeDebounceRef.current) {
        clearTimeout(resumeDebounceRef.current);
        resumeDebounceRef.current = null;
      }
      pauseListeners();
    },
  });

  /**
   * Clean up expired cache entries (older than 90 days)
   * For finished jobs: based on updatedAt or createdAt
   * For documents: based on createdAt
   * 
   * Uses whole-day boundary.
   */
  const cleanupExpiredCache = useCallback(async (data: any[], type: string) => {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - CACHE_EXPIRY_MS);
    cutoffDate.setHours(0, 0, 0, 0);
    const cutoffMs = cutoffDate.getTime();
    
    const filteredData = data.filter(item => {
      let dateField;
      if (type === 'documents') {
        dateField = item.createdAt;
      } else if (type === 'jobs') {
        // Only expire finished jobs; keep pending/waiting
        if (item.status === 'pending' || item.status === 'waiting') return true;
        dateField = item.updatedAt || item.createdAt;
      } else {
        return true;
      }
      
      if (!dateField) return true;
      
      const itemDate = dateField.toDate ? dateField.toDate().getTime() : new Date(dateField).getTime();
      return itemDate >= cutoffMs;
    });
    
    const expiredCount = data.length - filteredData.length;
    if (expiredCount > 0) {
      logger.debug(`Cleaned up ${expiredCount} expired ${type} entries`);
    }
    
    return { filteredData, expiredIds: [] };
  }, []);

  /**
   * Load data from local cache
   */
  const loadFromLocalCache = useCallback((expectedUid: string | null = null) => {
    logger.debug('[CACHE READ] Loading from local MMKV cache...');
    
    const cachedUid = mmkvHelpers.getString(CACHE_KEYS.UID);
    const cachedRole = mmkvHelpers.getString(CACHE_KEYS.USER_ROLE);
    const cachedCompanyId = mmkvHelpers.getString(CACHE_KEYS.COMPANY_ID);
    const identity = resolveCachedSessionIdentity({
      expectedUid,
      cachedUid,
      cachedRole,
      cachedCompanyId,
    });

    // Never trust scoped cache for a different authenticated user.
    setMmkvScope(identity.uid, identity.canReadScopedCache ? identity.companyId : null);

    if (!identity.canReadScopedCache) {
      return {
        hasCache: false,
        uid: identity.uid,
        role: identity.role,
        companyId: identity.companyId,
        profile: null,
        hasBusinessInfo: false,
        versions: {},
        companyVersions: {},
        identityMismatch: identity.identityMismatch,
      };
    }

    const cachedProfile = mmkvHelpers.getObject<UserProfile & { uid?: string }>(CACHE_KEYS.PROFILE);
    if (!isProfileCacheOwnedByUser(cachedProfile, identity.uid)) {
      console.warn('[CACHE READ] Ignoring scoped profile cache for a different user');
      setMmkvScope(identity.uid, null);
      return {
        hasCache: false,
        uid: identity.uid,
        role: null,
        companyId: null,
        profile: null,
        hasBusinessInfo: false,
        versions: {},
        companyVersions: {},
        identityMismatch: true,
      };
    }

    const cachedInventory = mmkvHelpers.getObject<InventoryPart[]>(CACHE_KEYS.INVENTORY);
    const cachedJobs = mmkvHelpers.getObject<Job[]>(CACHE_KEYS.JOBS);
    const cachedWorkers = mmkvHelpers.getObject<Record<string, Worker>>(CACHE_KEYS.WORKERS);
    const cachedCompanyInventory = mmkvHelpers.getObject<InventoryPart[]>(CACHE_KEYS.COMPANY_INVENTORY);
    const cachedCompanyJobs = mmkvHelpers.getObject<Job[]>(CACHE_KEYS.COMPANY_JOBS);
    const cachedDocuments = mmkvHelpers.getObject<AppDocument[]>(CACHE_KEYS.DOCUMENTS);
    const cachedHasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO);
    const cachedClients = mmkvHelpers.getObject<Client[]>(CACHE_KEYS.CLIENTS);
    const cachedSubscription = mmkvHelpers.getObject<Subscription>(CACHE_KEYS.SUBSCRIPTION);
    const cachedVersions = mmkvHelpers.getObject<CacheVersions>(CACHE_KEYS.CACHE_VERSIONS);
    const cachedCompanyVersions = mmkvHelpers.getObject<CacheVersions>(CACHE_KEYS.COMPANY_VERSIONS);
    
    if (cachedProfile) setProfile(cachedProfile);
    if (cachedInventory) setInventory(cachedInventory);
    if (cachedJobs) setJobs(cachedJobs);
    if (cachedWorkers) setWorkers(cachedWorkers);
    if (cachedCompanyInventory) setCompanyInventory(cachedCompanyInventory);
    if (cachedCompanyJobs) setCompanyJobs(cachedCompanyJobs);
    if (cachedDocuments) setDocuments(cachedDocuments);
    if (cachedClients) setClients(cachedClients);
    if (cachedSubscription) setSubscription(cachedSubscription);
    if (cachedVersions) setCacheVersions(cachedVersions);
    if (cachedCompanyVersions) setCompanyVersions(cachedCompanyVersions);
    
    return {
      hasCache: !!cachedProfile,
      uid: identity.uid,
      role: identity.role,
      companyId: identity.companyId,
      profile: cachedProfile,
      hasBusinessInfo: cachedHasBusinessInfo === 'true',
      versions: cachedVersions || {},
      companyVersions: cachedCompanyVersions || {},
      identityMismatch: identity.identityMismatch,
    };
  }, []);

  /**
   * Save data to local cache
   */
  const saveToLocalCache = useCallback((key: string, data: any) => {
    mmkvHelpers.setObject(key, data);
    
    // Update state based on key
    switch (key) {
      case CACHE_KEYS.PROFILE:
        setProfile(data);
        break;
      case CACHE_KEYS.INVENTORY:
        setInventory(data);
        break;
      case CACHE_KEYS.JOBS:
        setJobs(data);
        break;
      case CACHE_KEYS.WORKERS:
        setWorkers(data);
        break;
      case CACHE_KEYS.COMPANY_INVENTORY:
        setCompanyInventory(data);
        break;
      case CACHE_KEYS.COMPANY_JOBS:
        setCompanyJobs(data);
        break;
      case CACHE_KEYS.DOCUMENTS:
        setDocuments(data);
        break;
      case CACHE_KEYS.CLIENTS:
        setClients(data);
        break;
      case CACHE_KEYS.SUBSCRIPTION:
        setSubscription(data);
        break;
      case CACHE_KEYS.CACHE_VERSIONS:
        setCacheVersions(data);
        break;
      case CACHE_KEYS.COMPANY_VERSIONS:
        setCompanyVersions(data);
        break;
    }
  }, []);

  // Stable references to the module-level fetchers, compatible with useCallback dep arrays.
  const fetchDataFromBackend = useCallback(
    (field: string, uid: string, companyId: string, role: string) =>
      _fetchDataFromBackend(field, uid, companyId, role),
    [],
  );

  const fetchJobsPage = useCallback(
    (companyId: string, opts?: {
      pageSize?: number;
      afterCursor?: string;
      signal?: AbortSignal;
      status?: string | string[];
      dateField?: 'createdAt' | 'updatedAt' | 'finishedAt' | 'dueAt';
      dateFrom?: string;
      dateTo?: string;
    }) =>
      _fetchJobsPage(companyId, opts),
    [],
  );

  const fetchDocumentsPage = useCallback(
    (companyId: string, opts?: {
      pageSize?: number;
      afterCursor?: string;
      signal?: AbortSignal;
      dateField?: 'createdAt' | 'updatedAt' | 'documentDate';
      dateFrom?: string;
      dateTo?: string;
    }) =>
      _fetchDocumentsPage(companyId, opts),
    [],
  );

  const fetchCursorWindow = useCallback(
    async (
      fetchPage: (companyId: string, opts?: any) => Promise<{ items: any[]; nextCursor: string | null }>,
      companyId: string,
      pageSize = 200,
      baseOpts: Record<string, unknown> = {},
    ) => {
      const MAX_PAGES = 5;
      const MAX_ITEMS = 1_000;
      const allItems: any[] = [];
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;
      let pagesFetched = 0;

      do {
        pagesFetched++;
        const page = await fetchPage(companyId, { ...baseOpts, pageSize, afterCursor: nextCursor || undefined });
        if (Array.isArray(page.items) && page.items.length > 0) {
          allItems.push(...page.items);
        }

        if (allItems.length >= MAX_ITEMS || pagesFetched >= MAX_PAGES) {
          logger.warn(`fetchCursorWindow capped for ${companyId} (pages=${pagesFetched}, items=${allItems.length})`);
          break;
        }

        const candidateCursor = typeof page.nextCursor === 'string' && page.nextCursor.trim()
          ? page.nextCursor.trim()
          : null;
        if (!candidateCursor || seenCursors.has(candidateCursor)) {
          nextCursor = null;
          continue;
        }

        seenCursors.add(candidateCursor);
        nextCursor = candidateCursor;
      } while (nextCursor);

      return allItems;
    },
    [],
  );

  const fetchCompanySyncState = useCallback(
    (uid: string, companyId: string) => _fetchCompanySyncState(uid, companyId),
    [],
  );

  const fetchUserSyncState = useCallback(
    (uid: string, companyId: string) => _fetchUserSyncState(uid, companyId),
    [],
  );

  /**
   * Get MMKV cache key for a field
   */
  const getCacheKeyForField = (field: string) => {
    const mapping: Record<string, string> = {
      'profile': CACHE_KEYS.PROFILE,
      'inventory': CACHE_KEYS.INVENTORY,
      'companyInventory': CACHE_KEYS.COMPANY_INVENTORY,
      'subscription': CACHE_KEYS.SUBSCRIPTION,
      'jobs': CACHE_KEYS.JOBS,
      'companyJobs': CACHE_KEYS.COMPANY_JOBS,
      'workers': CACHE_KEYS.WORKERS,
      'documents': CACHE_KEYS.DOCUMENTS,
      'clients': CACHE_KEYS.CLIENTS,
    };
    return mapping[field] || field;
  };

  const applyBootstrappedJobDocumentCache = useCallback((role: string, jobsData: any[], documentsData: any[]) => {
    if (role === 'manager') {
      saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, jobsData);
      saveToLocalCache(CACHE_KEYS.JOBS, []);
      saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
    } else if (role === 'worker') {
      saveToLocalCache(CACHE_KEYS.JOBS, jobsData);
      saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
    } else if (role === 'basic') {
      saveToLocalCache(CACHE_KEYS.JOBS, []);
      saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
    } else if (role === 'dev') {
      saveToLocalCache(CACHE_KEYS.JOBS, []);
      saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
    } else {
      saveToLocalCache(CACHE_KEYS.JOBS, jobsData);
      saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
    }
  }, [saveToLocalCache]);

  const getExistingJobsCacheForRole = useCallback((role: string) => {
    if (role === 'manager') {
      const cached = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_JOBS);
      return Array.isArray(cached) ? cached : [];
    }
    if (role === 'basic' || role === 'dev') {
      return [];
    }
    const cached = mmkvHelpers.getObject(CACHE_KEYS.JOBS);
    return Array.isArray(cached) ? cached : [];
  }, []);

  /**
   * Set up cache refresh listeners.
   * 
   * NEW ARCHITECTURE: Summary-based versioning
   * - Company sync state is polled through the backend read model
   * - On version change: full re-fetch of the changed collection
   * - User cache doc has: { profile, inventory, subscription, lastUpdated }
   * 
   * All roles: user sync poller (profile/inventory) + company sync poller (version fields)
   */
  const setupCacheListeners = useCallback((uid: string, role: string, companyId: string | null) => {
    logger.debug(`Setting up cache listeners for ${role}...`);
    
    // Dev role doesn't need cache listeners
    if (role === 'dev') {
      logger.debug('Dev role: skipping cache listeners (support-only role)');
      return;
    }
    
    // Clean up existing listeners
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (companyUnsubscribeRef.current) {
      companyUnsubscribeRef.current();
      companyUnsubscribeRef.current = null;
    }
    if (inventoryUnsubscribeRef.current) {
      inventoryUnsubscribeRef.current();
      inventoryUnsubscribeRef.current = null;
    }
    
    // =====================================================
    // USER SYNC POLLER (for all roles - profile/inventory)
    // =====================================================
    let userPollTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextUserSyncPoll = () => {
      const nextIntervalMs = getNextCompanySyncPollIntervalMs(userPollIdleCountRef.current);
      userPollTimeoutId = setTimeout(() => {
        void pollUserSyncState();
      }, nextIntervalMs);
    };

    const pollUserSyncState = async () => {
      if (userPollInFlightRef.current) return;
      userPollInFlightRef.current = true;
      try {
        if (!companyId) return;
        const remoteVersions = await fetchUserSyncState(uid, companyId);
        const localVersions: Record<string, number> = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS) || {};
        let standardFields = role === 'basic' ? ['profile'] : ['profile', 'inventory'];
        standardFields.push('subscription');
        let changed = false;

        for (const field of standardFields) {
          const remoteVersion = Number(remoteVersions[field as keyof typeof remoteVersions] || 0);
          const localVersion = Number(localVersions[field] || 0);

          if (remoteVersion > localVersion) {
            logger.debug(`User sync mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
            if (field === 'subscription') {
              const subData = await fetchDataFromBackend('subscription', uid, companyId || '', role);
              saveToLocalCache(CACHE_KEYS.SUBSCRIPTION, subData);
            } else {
              const data = await fetchDataFromBackend(field, uid, companyId || '', role);
              if (data !== null) {
                const cacheKey = getCacheKeyForField(field);
                saveToLocalCache(cacheKey, data);
              }
            }
            localVersions[field] = remoteVersion;
            changed = true;
          }
        }

        if (changed) {
          saveToLocalCache(CACHE_KEYS.CACHE_VERSIONS, localVersions);
          userPollIdleCountRef.current = 0;
        } else {
          userPollIdleCountRef.current += 1;
        }
      } catch (error) {
        console.error('User sync polling error:', error);
      } finally {
        userPollInFlightRef.current = false;
        if (listenersActiveRef.current) {
          scheduleNextUserSyncPoll();
        }
      }
    };

    userPollIdleCountRef.current = 0;
    void pollUserSyncState();

    unsubscribeRef.current = () => {
      if (userPollTimeoutId) {
        clearTimeout(userPollTimeoutId);
        userPollTimeoutId = null;
      }
      userPollInFlightRef.current = false;
      userPollIdleCountRef.current = 0;
    };
    
    // =====================================================
    // COMPANY SYNC POLLER (for all non-dev roles)
    // Polls backend summary version fields and re-fetches on change
    // =====================================================
    if (companyId) {
      let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const scheduleNextCompanySyncPoll = () => {
        const nextIntervalMs = getNextCompanySyncPollIntervalMs(companyPollIdleCountRef.current);
        pollTimeoutId = setTimeout(() => {
          void pollCompanySyncState();
        }, nextIntervalMs);
      };

      const pollCompanySyncState = async () => {
        if (companyPollInFlightRef.current) return;
        companyPollInFlightRef.current = true;
        try {
          const remoteData = await fetchCompanySyncState(uid, companyId);
          const localVersions: Record<string, any> = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_VERSIONS) || {};

          logger.debug('Company sync state received:', JSON.stringify({
            jobsVersion: remoteData.jobsVersion,
            documentsVersion: remoteData.documentsVersion,
            clientsVersion: remoteData.clientsVersion,
            workersVersion: remoteData.workersVersion,
            companyInventoryVersion: remoteData.companyInventoryVersion,
          }));

          const fetchPromises: Promise<void>[] = [];
          const versionUpdates: Record<string, any> = {};

          const remoteJobsVersion = remoteData.jobsVersion || 0;
          const localJobsVersion = localVersions.jobsVersion || 0;
          const remoteDocsVersion = remoteData.documentsVersion || 0;
          const localDocsVersion = localVersions.documentsVersion || 0;

          if ((role !== 'basic' && role !== 'dev' && remoteJobsVersion !== localJobsVersion) ||
              (role !== 'dev' && remoteDocsVersion !== localDocsVersion)) {
            logger.debug(`Company jobs/documents changed: jobs ${localJobsVersion}->${remoteJobsVersion}, docs ${localDocsVersion}->${remoteDocsVersion}`);

            fetchPromises.push((async () => {
              const shouldFetchJobs = role !== 'basic' && role !== 'dev' && remoteJobsVersion !== localJobsVersion;
              const shouldFetchDocs = role !== 'dev' && remoteDocsVersion !== localDocsVersion;
              const cacheStartIso = getCacheStartDate().toISOString();

              const [openJobs, closedJobs, docsItems] = await Promise.all([
                shouldFetchJobs
                  ? fetchCursorWindow(fetchJobsPage, companyId, 200, { status: ['pending', 'waiting'], dateField: 'createdAt' })
                  : Promise.resolve([]),
                shouldFetchJobs
                  ? fetchCursorWindow(fetchJobsPage, companyId, 200, { status: ['finished', 'denied'], dateField: 'updatedAt', dateFrom: cacheStartIso })
                  : Promise.resolve([]),
                shouldFetchDocs
                  ? fetchCursorWindow(fetchDocumentsPage, companyId, 200, { dateField: 'createdAt', dateFrom: cacheStartIso })
                  : Promise.resolve([]),
              ]);
              const jobsItems = [...openJobs, ...closedJobs];
              const cachedDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS);
              const existingDocumentsCache = Array.isArray(cachedDocuments) ? cachedDocuments : [];

              applyBootstrappedJobDocumentCache(
                role,
                shouldFetchJobs ? jobsItems : getExistingJobsCacheForRole(role),
                shouldFetchDocs ? docsItems : existingDocumentsCache,
              );
              mmkvHelpers.setString(CACHE_KEYS.JOBS_LAST_SYNC, new Date().toISOString());
              mmkvHelpers.setString(CACHE_KEYS.DOCS_LAST_SYNC, new Date().toISOString());
              if (shouldFetchJobs) versionUpdates.jobsVersion = remoteJobsVersion;
              if (shouldFetchDocs) versionUpdates.documentsVersion = remoteDocsVersion;
            })());
          }

          const remoteClientsVersion = remoteData.clientsVersion || 0;
          const localClientsVersion = localVersions.clientsVersion || 0;
          if (remoteClientsVersion !== localClientsVersion) {
            logger.debug(`Clients version changed: local=${localClientsVersion}, remote=${remoteClientsVersion}`);

            fetchPromises.push((async () => {
              const clientsData = await fetchDataFromBackend('clients', uid, companyId, role);
              if (clientsData !== null) {
                saveToLocalCache(CACHE_KEYS.CLIENTS, clientsData);
                setClients(clientsData);
              }
              versionUpdates.clientsVersion = remoteClientsVersion;
            })());
          }

          if (role === 'manager') {
            const remoteWorkersVersion = remoteData.workersVersion || 0;
            const localWorkersVersion = localVersions.workersVersion || 0;

            if (remoteWorkersVersion !== localWorkersVersion) {
              logger.debug(`Workers version changed: local=${localWorkersVersion}, remote=${remoteWorkersVersion}`);

              fetchPromises.push((async () => {
                const workersData = await fetchDataFromBackend('workers', uid, companyId, role);
                if (workersData !== null) {
                  saveToLocalCache(CACHE_KEYS.WORKERS, workersData);
                }
                versionUpdates.workersVersion = remoteWorkersVersion;
              })());
            }
          }

          if (role !== 'dev') {
            const remoteCompanyInventoryVersion = remoteData.companyInventoryVersion || 0;
            const localCompanyInventoryVersion = localVersions.companyInventoryVersion || 0;

            if (remoteCompanyInventoryVersion !== localCompanyInventoryVersion) {
              logger.debug(`Company inventory version changed: local=${localCompanyInventoryVersion}, remote=${remoteCompanyInventoryVersion}`);

              fetchPromises.push((async () => {
                const companyInventoryData = await fetchDataFromBackend('companyInventory', uid, companyId, role);
                if (companyInventoryData !== null) {
                  saveToLocalCache(CACHE_KEYS.COMPANY_INVENTORY, companyInventoryData);
                  setCompanyInventory(companyInventoryData);
                }
                versionUpdates.companyInventoryVersion = remoteCompanyInventoryVersion;
              })());
            }
          }

          if (fetchPromises.length > 0) {
            await Promise.all(fetchPromises);
          }

          if (Object.keys(versionUpdates).length > 0) {
            const updatedVersions = { ...localVersions, ...versionUpdates };
            saveToLocalCache(CACHE_KEYS.COMPANY_VERSIONS, updatedVersions);
            companyPollIdleCountRef.current = 0;
          } else {
            companyPollIdleCountRef.current += 1;
          }
        } catch (error) {
          console.error('Company sync polling error:', error);
        } finally {
          companyPollInFlightRef.current = false;
          if (listenersActiveRef.current) {
            scheduleNextCompanySyncPoll();
          }
        }
      };

      companyPollIdleCountRef.current = 0;
      void pollCompanySyncState();

      companyUnsubscribeRef.current = () => {
        if (pollTimeoutId) {
          clearTimeout(pollTimeoutId);
          pollTimeoutId = null;
        }
        companyPollInFlightRef.current = false;
        companyPollIdleCountRef.current = 0;
      };
    }
    
    inventoryUnsubscribeRef.current = null;
    
    // Mark listeners as active
    listenersActiveRef.current = true;
    
    logger.debug(`Cache listeners set up for ${role}`);
  }, [applyBootstrappedJobDocumentCache, fetchCursorWindow, fetchCompanySyncState, fetchDataFromBackend, fetchUserSyncState, getExistingJobsCacheForRole, saveToLocalCache]);

  /**
   * Initialize cache for a user (called on login/app start)
   * Sets up backend sync polling.
   * 
   * Flow:
   * 1. Load from local cache first
   * 2. Check if uid/role/companyId exists in local cache
   * 3. If not, try to get from cached profile or fetch from backend (first login)
   * 4. Setup sync polling for version changes
   */
  const initializeCache = useCallback(async (
    userId: string,
    selectedCompanyId: string,
    selectedRole: string,
  ) => {
    logger.debug(`?? Initializing cache...`);
    setIsLoading(true);
    
    try {
      resetCacheState();

      const normalizedCompanyId = String(selectedCompanyId || '').trim();
      const normalizedRole = String(selectedRole || '').trim().toLowerCase();
      if (!userId || !/^\d+$/.test(normalizedCompanyId) || !normalizedRole) {
        throw new Error('An authenticated user and selected workspace are required');
      }

      // The explicit TenantProvider selection is the sole cache scope. Identity
      // metadata is global, so set it before reading the tenant-scoped cache.
      mmkvHelpers.setString(CACHE_KEYS.UID, userId);
      mmkvHelpers.setString(CACHE_KEYS.USER_ROLE, normalizedRole);
      mmkvHelpers.setString(CACHE_KEYS.COMPANY_ID, normalizedCompanyId);
      setMmkvScope(userId, normalizedCompanyId);

      // STEP 1: Load from local cache first
      const cachedData = loadFromLocalCache(userId) as {
        hasCache: boolean;
        uid: string | null;
        role: string | null;
        companyId: string | null;
        profile: UserProfile | null;
        hasBusinessInfo: boolean;
        versions: Record<string, number>;
        companyVersions: Record<string, number>;
        identityMismatch: boolean;
      };
      
      // STEP 2: Determine uid (UID), role, and companyId
      let uid = userId;
      let role: string | null = normalizedRole;
      let companyId: string | null = normalizedCompanyId;
      let profileData = cachedData.profile;
      let shouldForceFreshBootstrap = !cachedData.hasCache
        || cachedData.companyId !== normalizedCompanyId
        || cachedData.role !== normalizedRole;

      if (uid && cachedData.hasCache && !cachedData.identityMismatch) {
        const resolvedProfile = await fetchDataFromBackend(
          'profile',
          uid,
          normalizedCompanyId,
          normalizedRole,
        );

        if (!resolvedProfile) {
          console.error('Could not resolve profile from backend');
          setIsLoading(false);
          return null;
        }

        const resolvedRole = typeof resolvedProfile.role === 'string'
          ? resolvedProfile.role.toLowerCase()
          : null;
        const resolvedCompanyId = normalizedCompanyId;
        const companyMismatch = cachedData.companyId !== normalizedCompanyId;
        const roleMismatch = Boolean(resolvedRole && resolvedRole !== normalizedRole);

        if (companyMismatch || roleMismatch || !profileData) {
          console.warn('[CACHE] Refreshing scoped cache metadata from live profile', {
            uid,
            cachedCompanyId: companyId,
            resolvedCompanyId,
            companyMismatch,
            roleMismatch,
          });
          profileData = resolvedProfile;
          role = normalizedRole;
          companyId = normalizedCompanyId;
          shouldForceFreshBootstrap = true;

          setMmkvScope(uid, companyId);
          saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
        }
      }
      
      // If we have cached metadata, use it
      if (!cachedData.identityMismatch && uid && role && companyId && profileData && !shouldForceFreshBootstrap) {
        logger.debug(`?? Using cached credentials: ${uid} (${role})`);
      } else {
        // Try to get from cached profile
        if (profileData && !role) {
          role = normalizedRole;
          companyId = normalizedCompanyId;
        }
        
        // Use authenticated UID directly (no email-to-uid derivation)
        if (!uid && userId) {
          uid = userId;
        }
        
        // If still no profile, this is first login - fetch from backend.
        if (!profileData) {
          logger.debug('No cached profile, fetching from backend (first login)...');
          profileData = await fetchDataFromBackend('profile', uid || '', companyId || '', role || '');
          
          if (!profileData) {
            console.error('Could not fetch profile from backend');
            setIsLoading(false);
            return null;
          }
          
          role = normalizedRole;
          companyId = normalizedCompanyId;
          
          // Save profile to local cache
          saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
        }
        
        // Normalize role to lowercase for consistent comparisons across the app
        // Canonical roles are lowercase: manager, worker, user, basic, dev
        if (role && typeof role === 'string') {
          role = role.toLowerCase();
        }

      }

      // Never allow a profile/cache response to replace the explicit tenant.
      role = normalizedRole;
      companyId = normalizedCompanyId;

      // Save metadata to local cache using the authenticated user as the source of truth.
      setMmkvScope(uid, companyId);
      if (uid) mmkvHelpers.setString(CACHE_KEYS.UID, uid);
      if (role) mmkvHelpers.setString(CACHE_KEYS.USER_ROLE, role);
      else mmkvHelpers.delete(CACHE_KEYS.USER_ROLE);
      if (companyId) mmkvHelpers.setString(CACHE_KEYS.COMPANY_ID, companyId);
      else mmkvHelpers.delete(CACHE_KEYS.COMPANY_ID);
      if (profileData?.wid) mmkvHelpers.setString(CACHE_KEYS.USER_WID, String(profileData.wid));
      else mmkvHelpers.delete(CACHE_KEYS.USER_WID);
      
      logger.debug(`?? Cache init: ${uid} (${role}) @ ${companyId}`);
      
      // STEP 3: Check if this is first time (no local cache) or returning user
      if (shouldForceFreshBootstrap) {
        logger.debug('?? No local cache found, performing full fresh fetch...');
        await fetchAllFresh(uid || '', role || '', companyId || '');
        // Check if business_info exists through the backend (don't cache the data itself).
        const hasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO) === 'true';
        return { uid, role, companyId, hasBusinessInfo };
      }
      
      // STEP 4: Set up backend sync polling.
      // Polling syncs versions and fetches missing/outdated data.
      logger.debug('Setting up backend sync polling...');
      setupCacheListeners(uid || '', role || '', companyId);
      
      setIsInitialized(true);
      logger.debug('? Cache initialized successfully');
      
      // Read the flag (either from cache or freshly migrated)
      const hasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO) === 'true';
      return { uid, role, companyId, hasBusinessInfo };
      
    } catch (error) {
      console.error('? Cache initialization error:', error);
      setIsLoading(false);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [loadFromLocalCache, fetchDataFromBackend, resetCacheState, saveToLocalCache, setupCacheListeners]);

  /**
   * Fetch all data fresh from backend (first-time login).
   * Also fetches remote sync versions to store correct version numbers.
   */
  const fetchAllFresh = useCallback(async (uid: string, role: string, companyId: string) => {
    logger.debug('Fetching all data fresh from backend (first login)...');
    
    try {
      // Fetch profile for all roles
      const profileData = await fetchDataFromBackend('profile', uid, companyId, role);
      if (profileData) saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
      
      // Fetch subscription for all roles
      if (companyId) {
        try {
          const subData = await fetchDataFromBackend('subscription', uid, companyId, role);
          if (subData) {
            setSubscription(subData);
            saveToLocalCache(CACHE_KEYS.SUBSCRIPTION, subData);
          }
        } catch (e) {
          console.warn('Could not fetch subscription:', (e as Error).message);
        }
      }
      
      // Fetch inventory for all roles EXCEPT basic and dev (they have no inventory)
      if (role !== 'basic' && role !== 'dev') {
        const inventoryData = await fetchDataFromBackend('inventory', uid, companyId, role);
        if (inventoryData) saveToLocalCache(CACHE_KEYS.INVENTORY, inventoryData);
      } else {
        // Basic and dev roles: ensure inventory is empty
        saveToLocalCache(CACHE_KEYS.INVENTORY, []);
      }

      if (role !== 'dev' && companyId) {
        const companyInventoryData = await fetchDataFromBackend('companyInventory', uid, companyId, role);
        if (companyInventoryData) saveToLocalCache(CACHE_KEYS.COMPANY_INVENTORY, companyInventoryData);
      } else {
        saveToLocalCache(CACHE_KEYS.COMPANY_INVENTORY, []);
      }
      
      // Fetch role-specific standard fields
      if (role === 'manager') {
        const workersData = await fetchDataFromBackend('workers', uid, companyId, role);
        if (workersData) saveToLocalCache(CACHE_KEYS.WORKERS, workersData);
      } else if (role === 'dev') {
        // Dev role doesn't need workers
        logger.debug('?? Dev role: skipping workers fetch');
      }
      
      // Check if business_info exists through the read model so SQL-backed
      // companies do not depend on direct legacy database reads for registration state.
      if (role !== 'worker' && role !== 'dev' && companyId) {
        try {
          const businessInfo = await fetchDataFromBackend('business_info', uid, companyId, role);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, businessInfo ? 'true' : 'false');
        } catch (e) {
          console.warn('Could not check business_info existence:', (e as Error).message);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, 'false');
        }
      }
      
      // Fetch a bounded recent cursor window for the initial cache.
      logger.debug('Fetching the recent job/document cursor window for initial cache...');
      let jobsData: any[] = [];
      let documentsData: any[] = [];
      if (companyId) {
        const cacheStartIso = getCacheStartDate().toISOString();
        const [openJobsData, closedJobsData, allDocumentsData] = await Promise.all([
          role !== 'basic' && role !== 'dev'
            ? fetchCursorWindow(fetchJobsPage, companyId, 200, { status: ['pending', 'waiting'], dateField: 'createdAt' })
            : Promise.resolve([]),
          role !== 'basic' && role !== 'dev'
            ? fetchCursorWindow(fetchJobsPage, companyId, 200, { status: ['finished', 'denied'], dateField: 'updatedAt', dateFrom: cacheStartIso })
            : Promise.resolve([]),
          role !== 'dev'
            ? fetchCursorWindow(fetchDocumentsPage, companyId, 200, { dateField: 'createdAt', dateFrom: cacheStartIso })
            : Promise.resolve([]),
        ]);
        const allJobsData = [...openJobsData, ...closedJobsData];

        if (allJobsData.length > 0 || (role !== 'basic' && role !== 'dev')) {
          jobsData = allJobsData;
        }
        if (allDocumentsData.length > 0 || role !== 'dev') {
          documentsData = allDocumentsData;
        }
      }
      
      // Save fetched jobs to local cache (unified jobs collection)
      applyBootstrappedJobDocumentCache(role, jobsData, documentsData);
      
      // Fetch clients for all roles (shared company collection)
      if (companyId) {
        logger.debug('?? Fetching clients for initial cache...');
        const clientsData = await fetchDataFromBackend('clients', uid, companyId, role);
        if (Array.isArray(clientsData)) {
          saveToLocalCache(CACHE_KEYS.CLIENTS, clientsData);
          setClients(clientsData);
        }
      }
      
      // Fetch remote cache docs to get correct version numbers
      logger.debug('Fetching remote cache docs for version numbers...');
      const versions: Record<string, any> = {};
      const companyVersions: Record<string, any> = {};
      
      const remoteUserState = companyId
        ? await fetchUserSyncState(uid, companyId)
        : { profile: 0, inventory: 0, subscription: 0, updatedAt: '' };
      for (const key of ['profile', 'inventory', 'subscription']) {
        if (remoteUserState[key as keyof typeof remoteUserState] !== undefined) {
          versions[key] = remoteUserState[key as keyof typeof remoteUserState];
        }
      }
      
      // Fetch company sync state from the backend read model
      if (companyId) {
        const remoteCompanyState = await fetchCompanySyncState(uid, companyId);
        for (const key of ['jobsVersion', 'documentsVersion', 'clientsVersion', 'workersVersion', 'companyInventoryVersion']) {
          if (remoteCompanyState[key as keyof typeof remoteCompanyState] !== undefined) {
            companyVersions[key] = remoteCompanyState[key as keyof typeof remoteCompanyState];
          }
        }
      }
      
      // Save versions to local cache
      saveToLocalCache(CACHE_KEYS.CACHE_VERSIONS, versions);
      saveToLocalCache(CACHE_KEYS.COMPANY_VERSIONS, companyVersions);
      
      // Set up listeners
      setupCacheListeners(uid, role, companyId);
      setIsInitialized(true);
      setIsLoading(false);
      
      logger.debug('Initial cache populated with', jobsData.length, 'jobs');
    } catch (error) {
      console.error('Error fetching fresh data:', error);
      setIsLoading(false);
    }
  }, [applyBootstrappedJobDocumentCache, fetchCursorWindow, fetchCompanySyncState, fetchDataFromBackend, fetchDocumentsPage, fetchJobsPage, fetchUserSyncState, saveToLocalCache, setupCacheListeners]);

  const {
    addJob,
    updateJob,
    removeJob,
    acceptJob,
  } = useCacheJobActions({
    getUserRole,
    jobs,
    companyJobs,
    saveToLocalCache,
  });

  const {
    updateWorkers,
    addWorker,
    editWorker,
    deleteWorker,
  } = useCacheWorkerActions({
    workers,
    getUserRole,
    getCompanyId,
    saveToLocalCache,
  });

  const {
    fetchClients,
    addClient,
    updateClient,
    deleteClient,
  } = useCacheClientActions({
    getUid,
    getCompanyId,
    clients,
    saveToLocalCache,
    setClients,
  });

  /**
   * Add document
   * manager/user/basic adds document ? Company cache, increment document version
   */
  const addDocument = useCallback(async (document: any) => {
    if (!document.id) {
      console.error('Cannot add document without ID');
      return;
    }
    
    const newDocuments = [...documents, document];
    saveToLocalCache(CACHE_KEYS.DOCUMENTS, newDocuments);
  }, [documents, saveToLocalCache]);

  /**
   * Clear all cache (on logout)
   */
  const clearCache = useCallback(() => {
    logger.debug('??? Clearing all cache...');
    
    // Unsubscribe from listeners
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (companyUnsubscribeRef.current) {
      companyUnsubscribeRef.current();
      companyUnsubscribeRef.current = null;
    }
    if (inventoryUnsubscribeRef.current) {
      inventoryUnsubscribeRef.current();
      inventoryUnsubscribeRef.current = null;
    }
    
    // Clear MMKV storage
    mmkvHelpers.clearAll();
    
    // P2-4: Reset scope prefix
    setMmkvScope(null, null);
    
    // Reset state
    resetCacheState();
    
    listenersActiveRef.current = false;
    
    logger.debug('? Cache cleared');
  }, [resetCacheState]);

  // Archive-aware month and date-range queries — extracted to hooks/useArchiveQuery.ts
  const { fetchFromArchive, getDataForMonth, getDataForDateRange } = useArchiveQuery({
    getUserRole,
    getUid,
    getCompanyId,
    jobs,
    companyJobs,
    documents,
  });

  /**
   * Refresh specific cache data
   */
  const refreshCache = useCallback(async (field: string) => {
    const uid = getUid() || '';
    const role = getUserRole() || '';
    const companyId = getCompanyId() || '';
    
    const data = await fetchDataFromBackend(field, uid, companyId, role);
    if (data !== null) {
      const cacheKey = getCacheKeyForField(field);
      saveToLocalCache(cacheKey, data);
    }
  }, [getUid, getUserRole, getCompanyId, fetchDataFromBackend, saveToLocalCache]);

  // Context value — memoized to avoid unnecessary re-renders of consumers
  // that don't depend on the changed state slice.
  const value = useMemo<CacheContextValue>(() => ({
    // State
    isInitialized,
    isLoading,
    profile,
    inventory,
    jobs,
    workers,
    companyJobs,
    documents,
    clients,
    subscription,
    companyInventory,
    
    // Getters (primary)
    getUid,
    getUserRole,
    getCompanyId,
    
    // Initialization
    initializeCache,
    clearCache,
    
    // Jobs (unified)
    addJob,
    updateJob,
    removeJob,
    acceptJob,
    
    // Manager specific
    updateWorkers,
    addWorker,
    editWorker,
    deleteWorker,
    
    // Business
    addDocument,
    
    // Clients
    fetchClients,
    addClient,
    updateClient,
    deleteClient,
    
    // Smart date filtering (use these in JobMonitor and DocumentHistory)
    getDataForMonth,
    getDataForDateRange,
    fetchFromArchive,
    isWithinCacheRange,
    getCacheStartDate,
    
    // Utilities
    refreshCache,
    // Direct storage access (for special cases)
    storage: mmkvHelpers,
  }), [
    isInitialized, isLoading, profile, inventory, jobs, workers,
    companyJobs, documents, clients, subscription, companyInventory,
    getUid, getUserRole, getCompanyId,
    initializeCache, clearCache,
    addJob, updateJob, removeJob, acceptJob,
    updateWorkers, addWorker, editWorker, deleteWorker,
    addDocument,
    fetchClients, addClient, updateClient, deleteClient,
    getDataForMonth, getDataForDateRange, fetchFromArchive,
    refreshCache,
  ]);

  return (
    <CacheContext.Provider value={value}>
      {children}
    </CacheContext.Provider>
  );
}

export { CACHE_KEYS };
