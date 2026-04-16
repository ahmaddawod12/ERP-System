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
import { db, auth, storage as firebaseStorage, doc, getDoc, setDoc, onSnapshot, collection, getDocs, query, where, orderBy, limit, writeBatch, FieldValue, functions, httpsCallable } from '../firebase';
import { useAppStateListener } from '../hooks/useAppStateListener';
import type { CacheContextValue, UserProfile, Job, AppDocument, Client, Worker, InventoryPart, Subscription, CacheVersions, RoleTitle, Maybe } from '../types';
import { safeJsonParse } from '../utils/helpers';
import {
  fetchDataFromFirebase as _fetchDataFromFirebase,
  fetchDocumentById as _fetchDocumentById,
  fetchAllRecentJobs as _fetchAllRecentJobs,
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
  getCacheStartDate,
  isWithinCacheRange,
  getDocumentType,
} from './mmkv-storage';
import {
  isProfileCacheOwnedByUser,
  resolveCachedSessionIdentity,
} from './cache-identity';
import {
  buildJobMembershipQueryValues,
  roleUsesScopedJobAccess,
} from './job-membership';

// Create context
const CacheContext = createContext<CacheContextValue | null>(null);

function buildJobMembershipConstraints(wid: string | number | null): any[] {
  const values = buildJobMembershipQueryValues(wid);
  if (values.length === 0) return [];
  return [
    values.length === 1
      ? where('wid', '==', values[0])
      : where('wid', 'in', values),
  ];
}

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

  // Android lifecycle: Pause listeners when app backgrounds, resume when active
  useAppStateListener({
    onActive: () => {
      resumeListeners();
    },
    onBackground: () => {
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

  /**
   * Get MMKV cache key for a field
   */
  const getCacheKeyForField = (field: string) => {
    const mapping: Record<string, string> = {
      'profile': CACHE_KEYS.PROFILE,
      'inventory': CACHE_KEYS.INVENTORY,
      'subscription': CACHE_KEYS.SUBSCRIPTION,
      'jobs': CACHE_KEYS.JOBS,
      'companyJobs': CACHE_KEYS.COMPANY_JOBS,
      'workers': CACHE_KEYS.WORKERS,
      'documents': CACHE_KEYS.DOCUMENTS,
      'clients': CACHE_KEYS.CLIENTS,
    };
    return mapping[field] || field;
  };

  /**
   * Set up real-time listeners for cache version changes (snapshot listeners)
   * 
   * NEW ARCHITECTURE: Summary-based versioning
   * - Company cache doc has: { jobsVersion, documentsVersion, clientsVersion, workersVersion, updatedAt }
   * - On version change: full re-fetch of the changed collection
   * - User cache doc has: { profile, inventory, subscription, lastUpdated }
   * 
   * All roles: user cache listener (profile/inventory) + company cache listener (version fields)
   */
  const setupCacheListeners = useCallback((uid: string, role: string, companyId: string | null) => {
    console.log(`Setting up cache listeners for ${role}...`);
    const wid = getWid();
    
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
    // USER CACHE LISTENER (for all roles - profile/inventory)
    // =====================================================
    const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
    unsubscribeRef.current = onSnapshot(userCacheRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      
      const remoteVersions = snapshot.data() as Record<string, number> | undefined;
      const localVersions: Record<string, number> = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS) || {};
      
      console.log('User cache snapshot received');
      
      // Standard user cache fields
      let standardFields = role === 'basic' ? ['profile'] : ['profile', 'inventory'];
      standardFields.push('subscription');
      
      for (const field of standardFields) {
        const remoteVersion = remoteVersions![field] || 0;
        const localVersion = localVersions[field] || 0;
        
        if (remoteVersion > localVersion) {
          console.log(`Version mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
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
        }
      }
      
      // Save updated versions
      saveToLocalCache(CACHE_KEYS.CACHE_VERSIONS, localVersions);
      
    }, (error) => {
      console.error('User cache listener error:', error);
    });
    
    // =====================================================
    // COMPANY CACHE LISTENER (for all non-dev roles)
    // Listens to summary version fields and re-fetches on change
    // =====================================================
    if (companyId) {
      const companyCacheRef = doc(db, 'companies', companyId, 'data', 'cache');
      companyUnsubscribeRef.current = onSnapshot(companyCacheRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        
        const remoteData = snapshot.data() as Record<string, any>;
        const localVersions: Record<string, any> = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_VERSIONS) || {};
        
        console.log('Company cache snapshot received:', JSON.stringify({
          jobsVersion: remoteData.jobsVersion,
          documentsVersion: remoteData.documentsVersion,
          clientsVersion: remoteData.clientsVersion,
          workersVersion: remoteData.workersVersion,
        }));
        
        // I2: Collect all changed-version fetches and run them in parallel
        const fetchPromises: Promise<void>[] = [];
        const versionUpdates: Record<string, any> = {};

        // --- JOBS VERSION CHECK (C1: incremental sync) ---
        if (role !== 'basic' && role !== 'dev') {
          const remoteJobsVersion = remoteData.jobsVersion || 0;
          const localJobsVersion = localVersions.jobsVersion || 0;
          
          if (remoteJobsVersion !== localJobsVersion) {
            console.log(`Jobs version changed: local=${localJobsVersion}, remote=${remoteJobsVersion}`);
            
            fetchPromises.push((async () => {
              try {
                const lastSync = mmkvHelpers.getString(CACHE_KEYS.JOBS_LAST_SYNC) || null;
                const ninetyDaysAgo = getCacheStartDate().toISOString();
                const jobsRef = collection(db, 'companies', companyId, 'jobs');
                
                // C1: Incremental sync — only fetch jobs updated since lastSync
                const cacheKey = role === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
                if (lastSync) {
                  let deltaQuery;
                  if (roleUsesScopedJobAccess(role)) {
                    const scopedConstraints = buildJobMembershipConstraints(wid);
                    if (scopedConstraints.length === 0) {
                      versionUpdates.jobsVersion = remoteJobsVersion;
                      return;
                    }
                    deltaQuery = query(jobsRef,
                      where('updatedAt', '>', lastSync),
                      ...scopedConstraints
                    );
                  } else {
                    deltaQuery = query(jobsRef, where('updatedAt', '>', lastSync));
                  }
                  const deltaSnap = await getDocs(deltaQuery);
                  const updates = deltaSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
                  
                  // Merge updates into existing cache
                  const existingJobs: any[] = mmkvHelpers.getObject(cacheKey) || [];
                  const merged = [...existingJobs];
                  for (const updated of updates) {
                    const idx = merged.findIndex((j: any) => j.id === updated.id);
                    if (idx >= 0) merged[idx] = updated;
                    else merged.push(updated);
                  }
                  // Apply 90-day expiry filter on merged result
                  const filtered = merged.filter((j: any) => {
                    if (j.status === 'pending' || j.status === 'waiting') return true;
                    const dateField = j.updatedAt || j.createdAt;
                    if (!dateField) return true;
                    return dateField >= ninetyDaysAgo;
                  });
                  saveToLocalCache(cacheKey, filtered);
                  mmkvHelpers.setString(CACHE_KEYS.JOBS_LAST_SYNC, new Date().toISOString());
                  console.log(`Incremental sync: ${updates.length} jobs updated, ${filtered.length} total`);
                } else {
                  // No JOBS_LAST_SYNC set yet — bootstrap with a full role-aware re-fetch
                  const scopedConstraints = roleUsesScopedJobAccess(role)
                    ? buildJobMembershipConstraints(wid)
                    : [];
                  if (roleUsesScopedJobAccess(role) && scopedConstraints.length === 0) {
                    versionUpdates.jobsVersion = remoteJobsVersion;
                    return;
                  }
                  const [pendingSnap, recentSnap] = await Promise.all([
                    getDocs(scopedConstraints.length > 0
                      ? (query as any)(jobsRef, ...scopedConstraints, where('status', 'in', ['pending', 'waiting']))
                      : query(jobsRef, where('status', 'in', ['pending', 'waiting']))),
                    getDocs(scopedConstraints.length > 0
                      ? (query as any)(jobsRef, ...scopedConstraints, where('updatedAt', '>=', ninetyDaysAgo))
                      : query(jobsRef, where('updatedAt', '>=', ninetyDaysAgo))),
                  ]);
                  const fullMap = new Map();
                  pendingSnap.docs.forEach((d: any) => fullMap.set(d.id, { id: d.id, ...d.data() }));
                  recentSnap.docs.forEach((d: any) => fullMap.set(d.id, { id: d.id, ...d.data() }));
                  const jobsData = Array.from(fullMap.values());
                  saveToLocalCache(cacheKey, jobsData);
                  mmkvHelpers.setString(CACHE_KEYS.JOBS_LAST_SYNC, new Date().toISOString());
                  console.log(`Full sync: ${jobsData.length} jobs from Firebase`);
                }
              } catch (error) {
                console.error('Error syncing jobs:', error);
              }
              versionUpdates.jobsVersion = remoteJobsVersion;
            })());
          }
        }
        
        // --- DOCUMENTS VERSION CHECK (C1: incremental sync) ---
        if (role !== 'dev') {
          const remoteDocsVersion = remoteData.documentsVersion || 0;
          const localDocsVersion = localVersions.documentsVersion || 0;
          
          if (remoteDocsVersion !== localDocsVersion) {
            console.log(`Documents version changed: local=${localDocsVersion}, remote=${remoteDocsVersion}`);
            
            fetchPromises.push((async () => {
              try {
                const lastSync = mmkvHelpers.getString(CACHE_KEYS.DOCS_LAST_SYNC) || null;
                const ninetyDaysAgo = getCacheStartDate().toISOString();
                const documentsRef = collection(db, 'companies', companyId, 'documents');
                
                // C1: Incremental sync for documents
                if (lastSync) {
                  const deltaQuery = query(documentsRef, where('updatedAt', '>', lastSync));
                  const deltaSnap = await getDocs(deltaQuery);
                  const updates = deltaSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
                  const now = new Date().toISOString();
                  
                  const existingDocs: any[] = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
                  const merged = [...existingDocs];
                  for (const updated of updates) {
                    const idx = merged.findIndex((doc: any) => doc.id === updated.id);
                    if (idx >= 0) merged[idx] = updated;
                    else merged.push(updated);
                  }
                  // Apply 90-day expiry filter
                  const filtered = merged.filter((d: any) => {
                    const dateField = d.createdAt;
                    if (!dateField) return true;
                    return dateField >= ninetyDaysAgo;
                  });
                  saveToLocalCache(CACHE_KEYS.DOCUMENTS, filtered);
                  mmkvHelpers.setString(CACHE_KEYS.DOCS_LAST_SYNC, now);
                  console.log(`Incremental sync: ${updates.length} docs updated, ${filtered.length} total`);
                } else {
                  // First sync — full fetch
                  const documentsQuery = query(documentsRef, where('createdAt', '>=', ninetyDaysAgo));
                  const docsSnapshot = await getDocs(documentsQuery);
                  const documentsData = docsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
                  saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
                  mmkvHelpers.setString(CACHE_KEYS.DOCS_LAST_SYNC, new Date().toISOString());
                  console.log(`Full sync: ${documentsData.length} documents from Firebase`);
                }
              } catch (error) {
                console.error('Error syncing documents:', error);
              }
              versionUpdates.documentsVersion = remoteDocsVersion;
            })());
          }
        }
        
        // --- CLIENTS VERSION CHECK ---
        {
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
        }
        
        // --- WORKERS VERSION CHECK (manager only) ---
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
        
        // I2: Run all fetches in parallel
        if (fetchPromises.length > 0) {
          await Promise.all(fetchPromises);
        }
        
        // Save updated company versions (after all fetches complete)
        if (Object.keys(versionUpdates).length > 0) {
          const updatedVersions = { ...localVersions, ...versionUpdates };
          saveToLocalCache(CACHE_KEYS.COMPANY_VERSIONS, updatedVersions);
        }
        
      }, (error) => {
        console.error('Company cache listener error:', error);
      });
    }
    
    // =====================================================
    // I9: COMPANY INVENTORY LISTENER (consistent lifecycle)
    // Replaces the ad-hoc onSnapshot in CompanyInventory.js
    // =====================================================
    if (companyId && role !== 'dev') {
      const companyInventoryRef = doc(db, 'companies', companyId, 'data', 'inventory');
      inventoryUnsubscribeRef.current = onSnapshot(companyInventoryRef, (snapshot) => {
        const data = snapshot.exists() ? snapshot.data()! : {} as Record<string, any>;
        setCompanyInventory(Array.isArray(data.parts) ? data.parts : []);
      }, (error) => {
        console.error('Company inventory listener error:', error);
      });
    }
    
    // Mark listeners as active
    listenersActiveRef.current = true;
    
    console.log(`Cache listeners set up for ${role}`);
  }, [fetchDataFromFirebase, fetchDocumentById, saveToLocalCache, getWid]);

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
      
      // If we have cached metadata, use it
      if (!cachedData.identityMismatch && uid && role && companyId && profileData) {
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
      if (!cachedData.hasCache) {
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
          const subRef = doc(db, 'companies', companyId, 'data', 'subscription');
          const subSnap = await getDoc(subRef);
          if (subSnap.exists()) {
            const subData = subSnap.data() as Subscription;
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
      
      // Fetch role-specific standard fields
      if (role === 'manager') {
        const workersData = await fetchDataFromFirebase('workers', uid, companyId, role);
        if (workersData) saveToLocalCache(CACHE_KEYS.WORKERS, workersData);
      } else if (role === 'dev') {
        // Dev role doesn't need workers
        console.log('?? Dev role: skipping workers fetch');
      }
      
      // Check if business_info exists in Firestore (for registration check)
      // Don't cache the data - Cloud Functions fetch it directly for security
      if (role !== 'worker' && role !== 'dev' && companyId) {
        try {
          const bizRef = doc(db, 'companies', companyId, 'data', 'business_info');
          const bizDoc = await getDoc(bizRef);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, bizDoc.exists() ? 'true' : 'false');
        } catch (e) {
          console.warn('Could not check business_info existence:', (e as Error).message);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, 'false');
        }
      }
      
      // Fetch all recent jobs from Firebase
      console.log('Fetching all recent jobs for initial cache...');
      const { jobsData, documentsData } = await fetchAllRecentJobs(uid, companyId, role);
      
      // Save fetched jobs to local cache (unified jobs collection)
      if (role === 'manager') {
        saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, jobsData);
        saveToLocalCache(CACHE_KEYS.JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      } else if (role === 'worker') {
        saveToLocalCache(CACHE_KEYS.JOBS, jobsData);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
      } else if (role === 'basic') {
        // Basic role: NO jobs at all, only documents
        saveToLocalCache(CACHE_KEYS.JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      } else if (role === 'dev') {
        // Dev role: NO jobs, NO documents (support-only)
        saveToLocalCache(CACHE_KEYS.JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
      } else {
        // User role
        saveToLocalCache(CACHE_KEYS.JOBS, jobsData);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      }
      
      // Fetch clients for all roles (shared company collection)
      if (companyId) {
        console.log('?? Fetching clients for initial cache...');
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        // @ts-ignore: fetchClients is declared later but called at runtime
        await fetchClients(companyId);
      }
      
      // Fetch remote cache docs to get correct version numbers
      console.log('Fetching remote cache docs for version numbers...');
      const versions: Record<string, any> = {};
      const companyVersions: Record<string, any> = {};
      
      // Fetch user cache doc
      const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
      const userCacheSnap = await getDoc(userCacheRef);
      if (userCacheSnap.exists()) {
        const userCacheData = userCacheSnap.data() as Record<string, any>;
        Object.keys(userCacheData).forEach(key => {
          if (key !== 'lastUpdated') {
            versions[key] = userCacheData[key];
          }
        });
      }
      
      // Fetch company cache doc (summary versions: jobsVersion, documentsVersion, clientsVersion, workersVersion)
      if (companyId) {
        const companyCacheRef = doc(db, 'companies', companyId, 'data', 'cache');
        const companyCacheSnap = await getDoc(companyCacheRef);
        if (companyCacheSnap.exists()) {
          const companyCacheData = companyCacheSnap.data() as Record<string, any>;
          // Store summary version fields
          for (const key of ['jobsVersion', 'documentsVersion', 'clientsVersion', 'workersVersion']) {
            if (companyCacheData[key] !== undefined) {
              companyVersions[key] = companyCacheData[key];
            }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // @ts-ignore: fetchClients is declared after fetchAllFresh
  }, [fetchDataFromFirebase, fetchAllRecentJobs, saveToLocalCache, setupCacheListeners]);

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
    db,
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
   * Add a new client using a Firestore transaction
   * - Reads companies/{companyId} document for cid field
   * - Increments cid in company doc
   * - Creates companies/{companyId}/clients/{cid} with client data
   * - Updates local cache
   * 
   * @param {Object} clientData - { name, phone, email, address, city, vatNumber }
   * @returns {Object} - The created client with id
   */
  const legacyAddClient = useCallback(async (clientData: any) => {
    const companyId = getCompanyId();
    console.log('?? Adding client to company:', companyId);

    if (!companyId) {
      const error = new Error('Company name not found in cache');
      console.error('?', error);
      throw error;
    }

    try {
      // Call addClientV1 CF â€” uses phone-app cid counter pattern on the server side
      const addClientFn = httpsCallable(functions, 'addClientV1');
      const result = await addClientFn({ companyId, ...clientData });
      const newClient = (result.data as any).client;

      if (!newClient) {
        throw new Error('addClientV1 returned no client data');
      }

      // Update local cache immediately (optimistic)
      const updatedClients = [...clients, newClient];
      saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
      setClients(updatedClients);

      // Pre-increment local clientsVersion to match what the CF just wrote.
      preIncrementVersion('clientsVersion', true);

      console.log(`âœ… Client created with ID: ${newClient.id}`);
      return newClient;
    } catch (error) {
      console.error('âŒ Error creating client:', error);
      console.error('âŒ Error code:', (error as any).code);
      console.error('âŒ Error message:', (error as Error).message);
      throw error;
    }
  }, [getCompanyId, clients, saveToLocalCache, preIncrementVersion]);

  /**
   * Update an existing client
   */
  const legacyUpdateClient = useCallback(async (clientId: string, updates: any) => {
    const companyId = getCompanyId();
    if (!companyId) throw new Error('Company name not found');

    try {
      // Use Cloud Function for validation and consistent cache bumping
      const updateClientFn = httpsCallable(functions, 'updateClientV1');
      await updateClientFn({ companyId, clientId, ...updates });

      // Update local cache
      const updatedClients = clients.map(c => 
        c.id === clientId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
      );
      saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
      setClients(updatedClients); // Update state immediately

      // Pre-increment local version to match the CF bump and prevent a redundant re-fetch
      preIncrementVersion('clientsVersion', true);

      console.log(`? Client ${clientId} updated`);
    } catch (error) {
      console.error('Error updating client:', error);
      throw error;
    }
  }, [getCompanyId, clients, saveToLocalCache, preIncrementVersion]);

  /**
   * Delete a client via the deleteClientV1 Cloud Function.
   * The CF handles the Firestore delete and increments the company cache version,
   * so other devices (and the snapshot listener) are notified automatically.
   */
  const legacyDeleteClient = useCallback(async (clientId: string) => {
    const companyId = getCompanyId();
    if (!companyId) throw new Error('Company name not found');

    try {
      // CF deletes the Firestore doc and bumps companies/{companyId}/data/cache.clients
      const deleteClientFn = httpsCallable(functions, 'deleteClientV1');
      await deleteClientFn({ companyId, clientId });

      // Update local client list immediately (optimistic)
      const updatedClients = clients.filter(c => c.id !== clientId);
      saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
      setClients(updatedClients);

      // Pre-increment local clientsVersion to match the CF bump.
      preIncrementVersion('clientsVersion', true);

      console.log(`âœ… Client ${clientId} deleted via CF`);
    } catch (error) {
      console.error('Error deleting client:', error);
      throw error;
    }
  }, [getCompanyId, clients, saveToLocalCache, preIncrementVersion]);

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
