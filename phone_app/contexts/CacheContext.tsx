/**
 * CacheContext.js - MMKV-based caching with summary-version sync
 * 
 * Cache Structure (Firestore company cache document):
 * - companies/{companyId}/data/cache:
 *   { jobsVersion, documentsVersion, clientsVersion, workersVersion, updatedAt }
 * 
 * Sync Strategy:
 * - Snapshot listener on company cache doc
 * - On version mismatch: full re-fetch of the changed collection (within 90-day window)
 * - Constant-size cache doc (no per-document fields)
 * 
 * Unified Jobs Collection:
 * - All jobs live in companies/{companyId}/jobs
 * - Status field distinguishes: pending, waiting, finished, denied
 * - No p_/f_ prefixes on IDs (plain sequential numbers from jid)
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
import { auth, storage as firebaseStorage } from '../firebase';
import { useAppStateListener } from '../hooks/useAppStateListener';
import type { CacheContextValue, UserProfile, Job, AppDocument, Client, Worker, InventoryPart, Subscription, CacheVersions, RoleTitle, Maybe } from '../types';
import { safeJsonParse } from '../utils/helpers';
import {
  fetchDataFromFirebase as _fetchDataFromFirebase,
  fetchCompanySyncState as _fetchCompanySyncState,
  fetchUserSyncState as _fetchUserSyncState,
  fetchDocumentById as _fetchDocumentById,
  fetchAllRecentJobs as _fetchAllRecentJobs,
  fetchJobsPage as _fetchJobsPage,
  fetchDocumentsPage as _fetchDocumentsPage,
} from './cache-fetchers';
import { useArchiveQuery } from '../hooks/useArchiveQuery';
import { useCacheVersionActions } from './use-cache-version-actions';
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
   * Pause Firestore listeners when app is backgrounded (CRITICAL for Android)
   */
  const pauseListeners = useCallback(() => {
    if (!listenersActiveRef.current) return; // Already paused
    
    console.log('?? [CACHE] Pausing Firestore listeners to prevent background reads');
    
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
   * Resume Firestore listeners when app becomes active
   */
  const resumeListeners = useCallback(() => {
    if (listenersActiveRef.current) return; // Already active
    
    console.log('?? [CACHE] Resuming Firestore listeners');
    
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
      console.log(`Cleaned up ${expiredCount} expired ${type} entries`);
    }
    
    return { filteredData, expiredIds: [] };
  }, []);

  /**
   * Load data from local cache
   */
  const loadFromLocalCache = useCallback((expectedUid: string | null = null) => {
    console.log('[CACHE READ] Loading from local MMKV cache...');
    
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
  const fetchDataFromFirebase = useCallback(
    (field: string, uid: string, companyId: string, role: string) =>
      _fetchDataFromFirebase(field, uid, companyId, role),
    [],
  );

  const fetchDocumentById = useCallback(
    (docId: string, uid: string, companyId: string, role: string) =>
      _fetchDocumentById(docId, uid, companyId, role),
    [],
  );

  const fetchAllRecentJobs = useCallback(
    (uid: string, companyId: string, role: string) =>
      _fetchAllRecentJobs(uid, companyId, role),
    [],
  );

  const fetchJobsPage = useCallback(
    (companyId: string, opts?: { pageSize?: number; afterCursor?: string; signal?: AbortSignal }) =>
      _fetchJobsPage(companyId, opts),
    [],
  );

  const fetchDocumentsPage = useCallback(
    (companyId: string, opts?: { pageSize?: number; afterCursor?: string; signal?: AbortSignal }) =>
      _fetchDocumentsPage(companyId, opts),
    [],
  );

  const fetchAllCursorPages = useCallback(
    async (
      fetchPage: (companyId: string, opts?: { pageSize?: number; afterCursor?: string; signal?: AbortSignal }) => Promise<{ items: any[]; nextCursor: string | null }>,
      companyId: string,
      pageSize = 200,
    ) => {
      const allItems: any[] = [];
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;

      do {
        const page = await fetchPage(companyId, { pageSize, afterCursor: nextCursor || undefined });
        if (Array.isArray(page.items) && page.items.length > 0) {
          allItems.push(...page.items);
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
    (companyId: string) => _fetchCompanySyncState(companyId),
    [],
  );

  const fetchUserSyncState = useCallback(
    () => _fetchUserSyncState(),
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
    console.log(`Setting up cache listeners for ${role}...`);
    
    // Dev role doesn't need cache listeners
    if (role === 'dev') {
      console.log('Dev role: skipping cache listeners (support-only role)');
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
        const remoteVersions = await fetchUserSyncState();
        const localVersions: Record<string, number> = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS) || {};
        let standardFields = role === 'basic' ? ['profile'] : ['profile', 'inventory'];
        standardFields.push('subscription');
        let changed = false;

        for (const field of standardFields) {
          const remoteVersion = Number(remoteVersions[field as keyof typeof remoteVersions] || 0);
          const localVersion = Number(localVersions[field] || 0);

          if (remoteVersion > localVersion) {
            console.log(`User sync mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
            if (field === 'subscription') {
              const subData = await fetchDataFromFirebase('subscription', uid, companyId || '', role);
              saveToLocalCache(CACHE_KEYS.SUBSCRIPTION, subData);
            } else {
              const data = await fetchDataFromFirebase(field, uid, companyId || '', role);
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
          const remoteData = await fetchCompanySyncState(companyId);
          const localVersions: Record<string, any> = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_VERSIONS) || {};

          console.log('Company sync state received:', JSON.stringify({
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
            console.log(`Company jobs/documents changed: jobs ${localJobsVersion}->${remoteJobsVersion}, docs ${localDocsVersion}->${remoteDocsVersion}`);

            fetchPromises.push((async () => {
              // Use paginated fetches to avoid pulling full collection on every version bump.
              const shouldFetchJobs = role !== 'basic' && role !== 'dev' && remoteJobsVersion !== localJobsVersion;
              const shouldFetchDocs = role !== 'dev' && remoteDocsVersion !== localDocsVersion;

              const [jobsItems, docsItems] = await Promise.all([
                shouldFetchJobs ? fetchAllCursorPages(fetchJobsPage, companyId, 200) : Promise.resolve([]),
                shouldFetchDocs ? fetchAllCursorPages(fetchDocumentsPage, companyId, 200) : Promise.resolve([]),
              ]);

              applyBootstrappedJobDocumentCache(
                role,
                shouldFetchJobs ? jobsItems : mmkvHelpers.getObject(CACHE_KEYS.COMPANY_JOBS) ?? [],
                shouldFetchDocs ? docsItems : mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) ?? [],
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
            console.log(`Clients version changed: local=${localClientsVersion}, remote=${remoteClientsVersion}`);

            fetchPromises.push((async () => {
              const clientsData = await fetchDataFromFirebase('clients', uid, companyId, role);
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
              console.log(`Workers version changed: local=${localWorkersVersion}, remote=${remoteWorkersVersion}`);

              fetchPromises.push((async () => {
                const workersData = await fetchDataFromFirebase('workers', uid, companyId, role);
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
              console.log(`Company inventory version changed: local=${localCompanyInventoryVersion}, remote=${remoteCompanyInventoryVersion}`);

              fetchPromises.push((async () => {
                const companyInventoryData = await fetchDataFromFirebase('companyInventory', uid, companyId, role);
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
    
    console.log(`Cache listeners set up for ${role}`);
  }, [applyBootstrappedJobDocumentCache, fetchAllCursorPages, fetchAllRecentJobs, fetchCompanySyncState, fetchDataFromFirebase, fetchUserSyncState, saveToLocalCache]);

  /**
   * Initialize cache for a user (called on login/app start)
   * Sets up snapshot listeners on cache docs
   * 
   * Flow:
   * 1. Load from local cache first
   * 2. Check if uid/role/companyId exists in local cache
   * 3. If not, try to get from cached profile or fetch from Firebase (first login)
   * 4. Setup snapshot listeners (they handle version sync automatically on connect)
   */
  const initializeCache = useCallback(async (userId: string) => {
    console.log(`?? Initializing cache...`);
    setIsLoading(true);
    
    try {
      resetCacheState();

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
      let uid = userId || cachedData.uid;
      let role = cachedData.role;
      let companyId = cachedData.companyId;
      let profileData = cachedData.profile;
      let shouldForceFreshBootstrap = !cachedData.hasCache;

      if (uid && cachedData.hasCache && !cachedData.identityMismatch) {
        const resolvedProfile = await fetchDataFromFirebase('profile', uid, '', role || '');

        if (!resolvedProfile) {
          console.error('? Could not resolve profile from Firebase');
          setIsLoading(false);
          return null;
        }

        const resolvedRole = typeof resolvedProfile.role === 'string'
          ? resolvedProfile.role.toLowerCase()
          : null;
        const resolvedCompanyId = typeof resolvedProfile.companyId === 'string'
          ? resolvedProfile.companyId.trim() || null
          : null;
        const companyMismatch = isScopedCacheCompanyMismatch(companyId, resolvedCompanyId);
        const roleMismatch = Boolean(role && resolvedRole && role !== resolvedRole);

        if (companyMismatch || roleMismatch || !profileData) {
          console.warn('[CACHE] Refreshing scoped cache metadata from live profile', {
            uid,
            cachedCompanyId: companyId,
            resolvedCompanyId,
            companyMismatch,
            roleMismatch,
          });
          profileData = resolvedProfile;
          role = resolvedRole || role;
          companyId = resolvedCompanyId;
          shouldForceFreshBootstrap = true;

          setMmkvScope(uid, companyId);
          saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
        }
      }
      
      // If we have cached metadata, use it
      if (!cachedData.identityMismatch && uid && role && companyId && profileData && !shouldForceFreshBootstrap) {
        console.log(`?? Using cached credentials: ${uid} (${role})`);
      } else {
        // Try to get from cached profile
        if (profileData && !role) {
          role = profileData.role;
          companyId = profileData.companyId;
        }
        
        // Use Firebase UID directly (no email-to-uid derivation)
        if (!uid && userId) {
          uid = userId;
        }
        
        // If still no profile, this is first login - fetch from Firebase
        if (!profileData) {
          console.log('?? No cached profile, fetching from Firebase (first login)...');
          profileData = await fetchDataFromFirebase('profile', uid || '', companyId || '', role || '');
          
          if (!profileData) {
            console.error('? Could not fetch profile from Firebase');
            setIsLoading(false);
            return null;
          }
          
          role = profileData.role;
          companyId = profileData.companyId;
          
          // Save profile to local cache
          saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
        }
        
        // Normalize role to lowercase for consistent comparisons across the app
        // Canonical roles are lowercase: manager, worker, user, basic, dev
        if (role && typeof role === 'string') {
          role = role.toLowerCase();
        }

      }

      // Save metadata to local cache using the authenticated user as the source of truth.
      setMmkvScope(uid, companyId);
      if (uid) mmkvHelpers.setString(CACHE_KEYS.UID, uid);
      if (role) mmkvHelpers.setString(CACHE_KEYS.USER_ROLE, role);
      else mmkvHelpers.delete(CACHE_KEYS.USER_ROLE);
      if (companyId) mmkvHelpers.setString(CACHE_KEYS.COMPANY_ID, companyId);
      else mmkvHelpers.delete(CACHE_KEYS.COMPANY_ID);
      if (profileData?.wid) mmkvHelpers.setString(CACHE_KEYS.USER_WID, String(profileData.wid));
      else mmkvHelpers.delete(CACHE_KEYS.USER_WID);
      
      console.log(`?? Cache init: ${uid} (${role}) @ ${companyId}`);
      
      // STEP 3: Check if this is first time (no local cache) or returning user
      if (shouldForceFreshBootstrap) {
        console.log('?? No local cache found, performing full fresh fetch...');
        await fetchAllFresh(uid || '', role || '', companyId || '');
        // Check if business_info exists in Firestore (don't cache the data itself)
        const hasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO) === 'true';
        return { uid, role, companyId, hasBusinessInfo };
      }
      
      // STEP 4: Set up real-time snapshot listeners
      // The listeners will automatically sync versions and fetch any missing/outdated data
      // when they first connect (onSnapshot fires immediately with current state)
      console.log('?? Setting up cache listeners (will sync versions automatically)...');
      setupCacheListeners(uid || '', role || '', companyId);
      
      setIsInitialized(true);
      console.log('? Cache initialized successfully');
      
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
  }, [loadFromLocalCache, fetchDataFromFirebase, resetCacheState, saveToLocalCache, setupCacheListeners]);

  /**
   * Fetch all data fresh from Firebase (first-time login)
   * Also fetches remote cache doc versions to store correct version numbers
   */
  const fetchAllFresh = useCallback(async (uid: string, role: string, companyId: string) => {
    console.log('?? Fetching all data fresh from Firebase (first login)...');
    
    try {
      // Fetch profile for all roles
      const profileData = await fetchDataFromFirebase('profile', uid, companyId, role);
      if (profileData) saveToLocalCache(CACHE_KEYS.PROFILE, profileData);
      
      // Fetch subscription for all roles
      if (companyId) {
        try {
          const subData = await fetchDataFromFirebase('subscription', uid, companyId, role);
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
        const inventoryData = await fetchDataFromFirebase('inventory', uid, companyId, role);
        if (inventoryData) saveToLocalCache(CACHE_KEYS.INVENTORY, inventoryData);
      } else {
        // Basic and dev roles: ensure inventory is empty
        saveToLocalCache(CACHE_KEYS.INVENTORY, []);
      }

      if (role !== 'dev' && companyId) {
        const companyInventoryData = await fetchDataFromFirebase('companyInventory', uid, companyId, role);
        if (companyInventoryData) saveToLocalCache(CACHE_KEYS.COMPANY_INVENTORY, companyInventoryData);
      } else {
        saveToLocalCache(CACHE_KEYS.COMPANY_INVENTORY, []);
      }
      
      // Fetch role-specific standard fields
      if (role === 'manager') {
        const workersData = await fetchDataFromFirebase('workers', uid, companyId, role);
        if (workersData) saveToLocalCache(CACHE_KEYS.WORKERS, workersData);
      } else if (role === 'dev') {
        // Dev role doesn't need workers
        console.log('?? Dev role: skipping workers fetch');
      }
      
      // Check if business_info exists through the read model so SQL-backed
      // companies do not depend on direct Firestore reads for registration state.
      if (role !== 'worker' && role !== 'dev' && companyId) {
        try {
          const businessInfo = await fetchDataFromFirebase('business_info', uid, companyId, role);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, businessInfo ? 'true' : 'false');
        } catch (e) {
          console.warn('Could not check business_info existence:', (e as Error).message);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, 'false');
        }
      }
      
      // Fetch all recent jobs from Firebase
      console.log('Fetching all recent jobs for initial cache...');
      let { jobsData, documentsData } = await fetchAllRecentJobs(uid, companyId, role);
      if (companyId) {
        const [allJobsData, allDocumentsData] = await Promise.all([
          role !== 'basic' && role !== 'dev' ? fetchAllCursorPages(fetchJobsPage, companyId, 200) : Promise.resolve([]),
          role !== 'dev' ? fetchAllCursorPages(fetchDocumentsPage, companyId, 200) : Promise.resolve([]),
        ]);

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
        console.log('?? Fetching clients for initial cache...');
        const clientsData = await fetchDataFromFirebase('clients', uid, companyId, role);
        if (Array.isArray(clientsData)) {
          saveToLocalCache(CACHE_KEYS.CLIENTS, clientsData);
          setClients(clientsData);
        }
      }
      
      // Fetch remote cache docs to get correct version numbers
      console.log('Fetching remote cache docs for version numbers...');
      const versions: Record<string, any> = {};
      const companyVersions: Record<string, any> = {};
      
      const remoteUserState = await fetchUserSyncState();
      for (const key of ['profile', 'inventory', 'subscription']) {
        if (remoteUserState[key as keyof typeof remoteUserState] !== undefined) {
          versions[key] = remoteUserState[key as keyof typeof remoteUserState];
        }
      }
      
      // Fetch company sync state from the backend read model
      if (companyId) {
        const remoteCompanyState = await fetchCompanySyncState(companyId);
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
      
      console.log('Initial cache populated with', jobsData.length, 'jobs');
    } catch (error) {
      console.error('Error fetching fresh data:', error);
      setIsLoading(false);
    }
  }, [applyBootstrappedJobDocumentCache, fetchAllCursorPages, fetchCompanySyncState, fetchDataFromFirebase, fetchAllRecentJobs, fetchDocumentsPage, fetchJobsPage, fetchUserSyncState, saveToLocalCache, setupCacheListeners]);

  /**
   * Pre-increment a summary version field locally.
   * Used for optimistic updates so the snapshot listener won't trigger
   * an unnecessary re-fetch when the CF-written version arrives.
   * 
   * For user cache: standard fields (profile, inventory, subscription)
   * For company cache: summary fields (jobsVersion, documentsVersion, clientsVersion, workersVersion)
   */
  const preIncrementVersion = useCallback((field: string, isCompanyCache = false) => {
    const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
    const localVersions: Record<string, number> = mmkvHelpers.getObject(localVersionsKey) || {};
    localVersions[field] = (localVersions[field] || 0) + 1;
    saveToLocalCache(localVersionsKey, localVersions);
  }, [saveToLocalCache]);

  const {
    incrementCacheVersion,
    updateProfile,
    updateInventory,
  } = useCacheVersionActions({
    getUid,
    getCompanyId,
    saveToLocalCache,
    preIncrementVersion,
  });

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
    preIncrementVersion,
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
    preIncrementVersion,
  });

  const {
    fetchClients,
    addClient,
    updateClient,
    deleteClient,
  } = useCacheClientActions({
    getCompanyId,
    clients,
    saveToLocalCache,
    preIncrementVersion,
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
    // Pre-increment local documentsVersion (CF handles Firebase bump)
    preIncrementVersion('documentsVersion', true);
  }, [documents, saveToLocalCache, preIncrementVersion]);

  /**
   * Clear all cache (on logout)
   */
  const clearCache = useCallback(() => {
    console.log('??? Clearing all cache...');
    
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
    
    console.log('? Cache cleared');
  }, [resetCacheState]);

  // Archive-aware month and date-range queries — extracted to hooks/useArchiveQuery.ts
  const { fetchFromArchive, getDataForMonth, getDataForDateRange } = useArchiveQuery({
    getUserRole,
    getUid,
    getWid,
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
    
    const data = await fetchDataFromFirebase(field, uid, companyId, role);
    if (data !== null) {
      const cacheKey = getCacheKeyForField(field);
      saveToLocalCache(cacheKey, data);
    }
  }, [getUid, getUserRole, getCompanyId, fetchDataFromFirebase, saveToLocalCache]);

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
    
    // Profile & Inventory
    updateProfile,
    updateInventory,
    
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
    preIncrementVersion,
    
    // Direct storage access (for special cases)
    storage: mmkvHelpers,
  }), [
    isInitialized, isLoading, profile, inventory, jobs, workers,
    companyJobs, documents, clients, subscription, companyInventory,
    getUid, getUserRole, getCompanyId,
    initializeCache, clearCache,
    updateProfile, updateInventory,
    addJob, updateJob, removeJob, acceptJob,
    updateWorkers, addWorker, editWorker, deleteWorker,
    addDocument,
    fetchClients, addClient, updateClient, deleteClient,
    getDataForMonth, getDataForDateRange, fetchFromArchive,
    refreshCache, preIncrementVersion,
  ]);

  return (
    <CacheContext.Provider value={value}>
      {children}
    </CacheContext.Provider>
  );
}

export { CACHE_KEYS };
