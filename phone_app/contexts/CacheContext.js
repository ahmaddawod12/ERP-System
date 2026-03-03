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

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { db, auth, storage as firebaseStorage, doc, getDoc, setDoc, onSnapshot, updateDoc, collection, getDocs, query, where, orderBy, limit, writeBatch, FieldValue, functions, httpsCallable } from '../firebase';
import { useAppStateListener } from '../hooks/useAppStateListener';

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

// Create context
const CacheContext = createContext(null);

// Custom hook to use cache
export const useCache = () => {
  const context = useContext(CacheContext);
  if (!context) {
    throw new Error('useCache must be used within a CacheProvider');
  }
  return context;
};

export function CacheProvider({ children }) {
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [workers, setWorkers] = useState({});
  const [companyJobs, setCompanyJobs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [companyInventory, setCompanyInventory] = useState([]);
  const [cacheVersions, setCacheVersions] = useState({});
  const [companyVersions, setCompanyVersions] = useState({});
  
  // Refs for cleanup
  const unsubscribeRef = useRef(null);
  const companyUnsubscribeRef = useRef(null);
  const inventoryUnsubscribeRef = useRef(null); // I9: Company inventory listener
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
  const cleanupExpiredCache = useCallback(async (data, type) => {
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
  const loadFromLocalCache = useCallback(() => {
    console.log('[CACHE READ] Loading from local MMKV cache...');
    
    const cachedUid = mmkvHelpers.getString(CACHE_KEYS.UID);
    const cachedRole = mmkvHelpers.getString(CACHE_KEYS.USER_ROLE);
    const cachedCompanyId = mmkvHelpers.getString(CACHE_KEYS.COMPANY_ID);

    // P2-4: Set scope BEFORE reading any scoped keys
    setMmkvScope(cachedUid, cachedCompanyId);

    const cachedProfile = mmkvHelpers.getObject(CACHE_KEYS.PROFILE);
    const cachedInventory = mmkvHelpers.getObject(CACHE_KEYS.INVENTORY);
    const cachedJobs = mmkvHelpers.getObject(CACHE_KEYS.JOBS);
    const cachedWorkers = mmkvHelpers.getObject(CACHE_KEYS.WORKERS);
    const cachedCompanyJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_JOBS);
    const cachedDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS);
    const cachedHasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO);
    const cachedClients = mmkvHelpers.getObject(CACHE_KEYS.CLIENTS);
    const cachedSubscription = mmkvHelpers.getObject(CACHE_KEYS.SUBSCRIPTION);
    const cachedVersions = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS);
    const cachedCompanyVersions = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_VERSIONS);
    
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
      uid: cachedUid,
      role: cachedRole,
      companyId: cachedCompanyId,
      profile: cachedProfile,
      hasBusinessInfo: cachedHasBusinessInfo === 'true',
      versions: cachedVersions || {},
      companyVersions: cachedCompanyVersions || {},
    };
  }, []);

  /**
   * Save data to local cache
   */
  const saveToLocalCache = useCallback((key, data) => {
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

  /**
   * Fetch individual data from Firebase
   * For collections (jobs/documents), only fetch specific document IDs
   */
  const fetchDataFromFirebase = useCallback(async (field, uid, companyId, role) => {
    console.log(`?? [FIREBASE READ] Fetching ${field} from Firebase...`);
    
    try {
      switch (field) {
        case 'profile': {
          const profileRef = doc(db, 'users', uid, 'data', 'profile');
          const profileDoc = await getDoc(profileRef);
          return profileDoc.exists() ? profileDoc.data() : null;
        }
        
        case 'inventory': {
          const inventoryRef = doc(db, 'users', uid, 'data', 'inventory');
          const inventoryDoc = await getDoc(inventoryRef);
          if (inventoryDoc.exists()) {
            const inventoryData = inventoryDoc.data();
            return inventoryData.parts || [];
          }
          return [];
        }
        
        case 'workers': {
          if (role === 'manager') {
            const workersRef = collection(db, 'companies', companyId, 'workers');
            const snapshot = await getDocs(workersRef);
            const workersData = {};
            snapshot.forEach(docSnap => {
              const workerDoc = docSnap.data() || {};
              // Workers are keyed by wid (sequential ID) in Firestore
              const wid = docSnap.id;
              workersData[wid] = {
                ...workerDoc,
                wid,
              };
            });
            return workersData;
          }
          return {};
        }
        
        case 'business_info': {
          // business_info is no longer cached - only check existence
          // Cloud Functions fetch it directly from Firestore for security
          return null;
        }
        
        case 'clients': {
          if (!companyId) return [];
          const clientsRef = collection(db, 'companies', companyId, 'clients');
          const snapshot = await getDocs(clientsRef);
          const clientsList = [];
          snapshot.forEach(d => {
            clientsList.push({ id: d.id, ...d.data() });
          });
          clientsList.sort((a, b) => parseInt(a.id) - parseInt(b.id));
          return clientsList;
        }
        
        case 'subscription': {
          if (!companyId) return null;
          const subRef = doc(db, 'companies', companyId, 'data', 'subscription');
          const subSnap = await getDoc(subRef);
          return subSnap.exists() ? subSnap.data() : null;
        }
        
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error fetching ${field} from Firebase:`, error);
      return null;
    }
  }, []);

  /**
   * Fetch a single document by ID from the unified jobs or documents collection.
   * Tries jobs first, then documents.
   */
  const fetchDocumentById = useCallback(async (docId, uid, companyId, role) => {
    console.log(`[FIREBASE READ] Fetching document ${docId} from Firebase...`);
    
    try {
      // Try jobs collection first
      let docRef = doc(db, 'companies', companyId, 'jobs', docId);
      let docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docId, ...docSnap.data() };
      }
      
      // Try documents collection
      docRef = doc(db, 'companies', companyId, 'documents', docId);
      docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docId, ...docSnap.data() };
      }
      
      console.warn(`Document ${docId} not found in jobs or documents collection`);
      return null;
    } catch (error) {
      console.error(`Error fetching document ${docId}:`, error);
      return null;
    }
  }, []);

  /**
   * Fetch all recent jobs (within 90 days for finished, all pending) from Firebase
   * Used on first initialization when no local cache exists
   * Returns unified jobs array and documents array
   */
  const fetchAllRecentJobs = useCallback(async (uid, companyId, role) => {
    // Dev role has no jobs or documents - return early
    if (role === 'dev') {
      console.log('Dev role: skipping all jobs/documents fetch (early return)');
      return { jobsData: [], documentsData: [] };
    }
    
    console.log('[FIREBASE READ] Fetching all recent jobs from Firebase (first-time init)...');
    const ninetyDaysAgo = getCacheStartDate().toISOString();
    
    try {
      let jobsData = [];
      let documentsData = [];
      
      if (role === 'manager') {
        // Manager: fetch all company jobs (pending + recent finished)
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        const jobsSnapshot = await getDocs(jobsRef);
        const allJobs = jobsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Keep all pending/waiting + finished within 90 days
        jobsData = allJobs.filter(j => {
          if (j.status === 'pending' || j.status === 'waiting') return true;
          const dateField = j.updatedAt || j.createdAt;
          if (!dateField) return true;
          return dateField >= ninetyDaysAgo;
        });
        console.log(`Fetched ${jobsData.length} jobs for manager`);
        
        // Manager: fetch all company documents (within 90 days)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(documentsRef, where('createdAt', '>=', ninetyDaysAgo));
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Fetched ${documentsData.length} documents for manager`);
        
      } else if (role === 'worker') {
        // Worker: fetch assigned jobs by wid (worker sequential ID)
        const wid = getWid();
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (wid) {
          const workerQuery = query(jobsRef, where('wid', '==', wid));
          const jobsSnapshot = await getDocs(workerQuery);
          const allJobs = jobsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          jobsData = allJobs.filter(j => {
            if (j.status === 'pending' || j.status === 'waiting') return true;
            const dateField = j.updatedAt || j.createdAt;
            if (!dateField) return true;
            return dateField >= ninetyDaysAgo;
          });
        }
        console.log(`Fetched ${jobsData.length} jobs for worker`);
        
      } else if (role === 'user') {
        // User: fetch all jobs (solo user - within 90 days for finished)
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        const jobsSnapshot = await getDocs(jobsRef);
        const allJobs = jobsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        jobsData = allJobs.filter(j => {
          if (j.status === 'pending' || j.status === 'waiting') return true;
          const dateField = j.updatedAt || j.createdAt;
          if (!dateField) return true;
          return dateField >= ninetyDaysAgo;
        });
        console.log(`Fetched ${jobsData.length} jobs for user`);
        
        // User: fetch documents (within 90 days)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(documentsRef, where('createdAt', '>=', ninetyDaysAgo));
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Fetched ${documentsData.length} documents for user`);
      } else if (role === 'basic') {
        // Basic: documents only (NO jobs)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(documentsRef, where('createdAt', '>=', ninetyDaysAgo));
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Fetched ${documentsData.length} documents for basic user`);
      }
      
      return { jobsData, documentsData };
    } catch (error) {
      console.error('Error fetching all recent jobs:', error);
      return { jobsData: [], documentsData: [] };
    }
  }, []);

  /**
   * Get MMKV cache key for a field
   */
  const getCacheKeyForField = (field) => {
    const mapping = {
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
  const setupCacheListeners = useCallback((uid, role, companyId) => {
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
      
      const remoteVersions = snapshot.data();
      const localVersions = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS) || {};
      
      console.log('User cache snapshot received');
      
      // Standard user cache fields
      let standardFields = role === 'basic' ? ['profile'] : ['profile', 'inventory'];
      standardFields.push('subscription');
      
      for (const field of standardFields) {
        const remoteVersion = remoteVersions[field] || 0;
        const localVersion = localVersions[field] || 0;
        
        if (remoteVersion > localVersion) {
          console.log(`Version mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
          if (field === 'subscription') {
            const subData = await fetchDataFromFirebase('subscription', uid, companyId, role);
            saveToLocalCache(CACHE_KEYS.SUBSCRIPTION, subData);
          } else {
            const data = await fetchDataFromFirebase(field, uid, companyId, role);
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
        
        const remoteData = snapshot.data();
        const localVersions = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_VERSIONS) || {};
        
        console.log('Company cache snapshot received:', JSON.stringify({
          jobsVersion: remoteData.jobsVersion,
          documentsVersion: remoteData.documentsVersion,
          clientsVersion: remoteData.clientsVersion,
          workersVersion: remoteData.workersVersion,
        }));
        
        // I2: Collect all changed-version fetches and run them in parallel
        const fetchPromises = [];
        const versionUpdates = {};

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
                if (lastSync) {
                  let deltaQuery;
                  if (role === 'worker') {
                    deltaQuery = query(jobsRef,
                      where('updatedAt', '>', lastSync),
                      where('wid', '==', wid)
                    );
                  } else {
                    deltaQuery = query(jobsRef, where('updatedAt', '>', lastSync));
                  }
                  const deltaSnap = await getDocs(deltaQuery);
                  const updates = deltaSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                  const now = new Date().toISOString();
                  
                  // Merge updates into existing cache
                  const cacheKey = role === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
                  const existingJobs = mmkvHelpers.getObject(cacheKey) || [];
                  const merged = [...existingJobs];
                  for (const updated of updates) {
                    const idx = merged.findIndex(j => j.id === updated.id);
                    if (idx >= 0) merged[idx] = updated;
                    else merged.push(updated);
                  }
                  // Apply 90-day expiry filter on merged result
                  const filtered = merged.filter(j => {
                    if (j.status === 'pending' || j.status === 'waiting') return true;
                    const dateField = j.updatedAt || j.createdAt;
                    if (!dateField) return true;
                    return dateField >= ninetyDaysAgo;
                  });
                  saveToLocalCache(cacheKey, filtered);
                  mmkvHelpers.setString(CACHE_KEYS.JOBS_LAST_SYNC, now);
                  console.log(`Incremental sync: ${updates.length} jobs updated, ${filtered.length} total`);
                } else {
                  // First sync — full fetch (fallback)
                  let jobsSnapshot;
                  if (role === 'worker') {
                    const workerQuery = query(jobsRef, where('wid', '==', wid));
                    jobsSnapshot = await getDocs(workerQuery);
                  } else {
                    jobsSnapshot = await getDocs(jobsRef);
                  }
                  const allJobs = jobsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                  const filteredJobs = allJobs.filter(j => {
                    if (j.status === 'pending' || j.status === 'waiting') return true;
                    const dateField = j.updatedAt || j.createdAt;
                    if (!dateField) return true;
                    return dateField >= ninetyDaysAgo;
                  });
                  const cacheKey = role === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
                  saveToLocalCache(cacheKey, filteredJobs);
                  mmkvHelpers.setString(CACHE_KEYS.JOBS_LAST_SYNC, new Date().toISOString());
                  console.log(`Full sync: ${filteredJobs.length} jobs from Firebase`);
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
                  const updates = deltaSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                  const now = new Date().toISOString();
                  
                  const existingDocs = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
                  const merged = [...existingDocs];
                  for (const updated of updates) {
                    const idx = merged.findIndex(doc => doc.id === updated.id);
                    if (idx >= 0) merged[idx] = updated;
                    else merged.push(updated);
                  }
                  // Apply 90-day expiry filter
                  const filtered = merged.filter(d => {
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
                  const documentsData = docsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
        const data = snapshot.exists() ? snapshot.data() : {};
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
  const initializeCache = useCallback(async (userId) => {
    console.log(`?? Initializing cache...`);
    setIsLoading(true);
    
    try {
      // STEP 1: Load from local cache first
      const cachedData = loadFromLocalCache();
      
      // STEP 2: Determine uid (UID), role, and companyId
      let uid = cachedData.uid;
      let role = cachedData.role;
      let companyId = cachedData.companyId;
      let profileData = cachedData.profile;
      
      // If we have cached metadata, use it
      if (uid && role && companyId && profileData) {
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
          profileData = await fetchDataFromFirebase('profile', uid, companyId, role);
          
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

        // Save metadata to local cache
        if (uid) mmkvHelpers.setString(CACHE_KEYS.UID, uid);
        if (role) mmkvHelpers.setString(CACHE_KEYS.USER_ROLE, role);
        if (companyId) mmkvHelpers.setString(CACHE_KEYS.COMPANY_ID, companyId);
        // Store worker sequential ID for job queries (workers only)
        if (profileData?.wid) mmkvHelpers.setString(CACHE_KEYS.USER_WID, String(profileData.wid));

        // P2-4: Set MMKV scope so all subsequent reads/writes are user-namespaced
        setMmkvScope(uid, companyId);
      }
      
      console.log(`?? Cache init: ${uid} (${role}) @ ${companyId}`);
      
      // STEP 3: Check if this is first time (no local cache) or returning user
      if (!cachedData.hasCache) {
        console.log('?? No local cache found, performing full fresh fetch...');
        await fetchAllFresh(uid, role, companyId);
        // Check if business_info exists in Firestore (don't cache the data itself)
        const hasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO) === 'true';
        return { uid, role, companyId, hasBusinessInfo };
      }
      
      // STEP 4: Set up real-time snapshot listeners
      // The listeners will automatically sync versions and fetch any missing/outdated data
      // when they first connect (onSnapshot fires immediately with current state)
      console.log('?? Setting up cache listeners (will sync versions automatically)...');
      setupCacheListeners(uid, role, companyId);
      
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
  }, [loadFromLocalCache, fetchDataFromFirebase, saveToLocalCache, setupCacheListeners]);

  /**
   * Fetch all data fresh from Firebase (first-time login)
   * Also fetches remote cache doc versions to store correct version numbers
   */
  const fetchAllFresh = useCallback(async (uid, role, companyId) => {
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
            const subData = subSnap.data();
            setSubscription(subData);
            saveToLocalCache(CACHE_KEYS.SUBSCRIPTION, subData);
          }
        } catch (e) {
          console.warn('Could not fetch subscription:', e.message);
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
          console.warn('Could not check business_info existence:', e.message);
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
        await fetchClients(companyId);
      }
      
      // Fetch remote cache docs to get correct version numbers
      console.log('Fetching remote cache docs for version numbers...');
      const versions = {};
      const companyVersions = {};
      
      // Fetch user cache doc
      const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
      const userCacheSnap = await getDoc(userCacheRef);
      if (userCacheSnap.exists()) {
        const userCacheData = userCacheSnap.data();
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
          const companyCacheData = companyCacheSnap.data();
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
  }, [fetchDataFromFirebase, fetchAllRecentJobs, saveToLocalCache, setupCacheListeners, fetchClients]);

  /**
   * Pre-increment a summary version field locally.
   * Used for optimistic updates so the snapshot listener won't trigger
   * an unnecessary re-fetch when the CF-written version arrives.
   * 
   * For user cache: standard fields (profile, inventory, subscription)
   * For company cache: summary fields (jobsVersion, documentsVersion, clientsVersion, workersVersion)
   */
  const preIncrementVersion = useCallback((field, isCompanyCache = false) => {
    const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
    const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
    localVersions[field] = (localVersions[field] || 0) + 1;
    saveToLocalCache(localVersionsKey, localVersions);
  }, [saveToLocalCache]);

  /**
   * Increment cache version in Firebase for user cache fields (profile, inventory).
   * Company cache versions are managed by Cloud Functions only.
   */
  const incrementCacheVersion = useCallback(async (field, isCompanyCache = false) => {
    if (isCompanyCache) {
      // Company cache versions are bumped by Cloud Functions, not the client.
      // Just pre-increment locally for optimistic UI.
      preIncrementVersion(field, true);
      return;
    }
    
    const uid = getUid();
    try {
      // Pre-increment local version
      preIncrementVersion(field, false);
      
      // Update Firebase user cache
      const cacheRef = doc(db, `users/${uid}/data/cache`);
      await updateDoc(cacheRef, { [field]: FieldValue.increment(1) });
    } catch (error) {
      console.error(`Error incrementing ${field} version:`, error);
    }
  }, [getUid, preIncrementVersion]);

  /**
   * Update profile cache
   */
  const updateProfile = useCallback(async (newProfile) => {
    saveToLocalCache(CACHE_KEYS.PROFILE, newProfile);
    await incrementCacheVersion('profile', false);
  }, [saveToLocalCache, incrementCacheVersion]);

  /**
   * Update inventory cache
   */
  const updateInventory = useCallback(async (newInventory) => {
    const uid = getUid();
    const companyId = getCompanyId() || uid;
    if (!uid) {
      console.error('Cannot update inventory: no uid');
      return;
    }
    if (!companyId) {
      console.error('Cannot update inventory: no companyId');
      return;
    }
    
    // 1. Update local cache FIRST
    saveToLocalCache(CACHE_KEYS.INVENTORY, newInventory);
    
    // 2. Save via Cloud Function (server-authoritative inventory mutation path)
    const updateInventoryFn = httpsCallable(functions, 'updateInventoryV1');
    await updateInventoryFn({
      companyId,
      action: 'replaceParts',
      scope: 'user',
      targetUid: uid,
      parts: Array.isArray(newInventory) ? newInventory : [],
    });
    
    console.log('Inventory updated via Cloud Function');
  }, [saveToLocalCache, getUid, getCompanyId]);

  /**
   * Add a job to the unified jobs cache (prevents duplicates).
   * Cloud Functions handle Firestore writes and version bumps.
   * This does optimistic local cache updates only.
   */
  const addJob = useCallback((job) => {
    const role = getUserRole();
    
    if (!job.id) {
      console.error('Cannot add job without ID');
      return;
    }
    
    // Helper to add job without duplicates
    const addJobToArray = (arr, newJob) => {
      const filtered = arr.filter(j => j.id !== newJob.id);
      return [...filtered, newJob];
    };
    
    if (role === 'manager') {
      const updated = addJobToArray(companyJobs, job);
      saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, updated);
    } else {
      const updated = addJobToArray(jobs, job);
      saveToLocalCache(CACHE_KEYS.JOBS, updated);
    }
    
    // Pre-increment jobsVersion so snapshot listener won't double-fetch
    preIncrementVersion('jobsVersion', true);
  }, [getUserRole, jobs, companyJobs, saveToLocalCache, preIncrementVersion]);

  /**
   * Update a job in the unified jobs cache.
   */
  const updateJob = useCallback((jobId, updates) => {
    const role = getUserRole();
    
    const updateInArray = (arr) =>
      arr.map(j => j.id === jobId ? { ...j, ...updates } : j);
    
    if (role === 'manager') {
      saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, updateInArray(companyJobs));
    } else {
      saveToLocalCache(CACHE_KEYS.JOBS, updateInArray(jobs));
    }
    
    preIncrementVersion('jobsVersion', true);
  }, [getUserRole, jobs, companyJobs, saveToLocalCache, preIncrementVersion]);

  /**
   * Remove a job from the unified jobs cache.
   */
  const removeJob = useCallback((jobId) => {
    const role = getUserRole();
    
    if (role === 'manager') {
      const filtered = companyJobs.filter(j => j.id !== jobId);
      saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, filtered);
    } else {
      const filtered = jobs.filter(j => j.id !== jobId);
      saveToLocalCache(CACHE_KEYS.JOBS, filtered);
    }
    
    preIncrementVersion('jobsVersion', true);
  }, [getUserRole, jobs, companyJobs, saveToLocalCache, preIncrementVersion]);

  /**
   * Accept/finish a job: update status in-place within the unified jobs cache.
   * No more collection move or ID conversion needed.
   * 
   * @param {string} jobId - The job ID
   * @param {object} updates - Fields to merge (e.g. { status: 'finished', finishedAt: ... })
   */
  const acceptJob = useCallback((jobId, updates) => {
    const role = getUserRole();
    
    const mergeUpdates = (arr) =>
      arr.map(j => j.id === jobId ? { ...j, ...updates } : j);
    
    if (role === 'manager') {
      saveToLocalCache(CACHE_KEYS.COMPANY_JOBS, mergeUpdates(companyJobs));
    } else {
      saveToLocalCache(CACHE_KEYS.JOBS, mergeUpdates(jobs));
    }
    
    preIncrementVersion('jobsVersion', true);
  }, [getUserRole, jobs, companyJobs, saveToLocalCache, preIncrementVersion]);

  /**
   * Update workers list (manager only)
   */
  const updateWorkers = useCallback(async (newWorkers) => {
    saveToLocalCache(CACHE_KEYS.WORKERS, newWorkers);
  }, [saveToLocalCache]);

  /**
   * Add worker to cache (called AFTER cloud function creates Auth user and Firestore docs)
   * Updates:
   * 1. Local cache workers list
   * 2. Increment cache version
   * 
   * @param {string} wid - Worker ID 
   * @param {object} workerData - { email, name, phoneNumber, uid }
   */
  const addWorker = useCallback(async (wid, workerData) => {
    const role = getUserRole();
    const companyId = getCompanyId();
    
    if (role !== 'manager') {
      console.error('Only managers can add workers');
      throw new Error('Only managers can add workers');
    }
    
    if (!companyId) {
      console.error('No company name found');
      throw new Error('No company name found');
    }
    
    console.log(`?? Adding worker ${wid} to cache...`);
    
    try {
      // 1. Update local cache
      const updatedWorkers = {
        ...workers,
        [wid]: {
          uid: workerData.uid,
          wid: workerData.wid ?? null,
          email: workerData.email,
          name: workerData.name,
          phoneNumber: workerData.phoneNumber,
          role: 'worker',
          companyId: companyId
        }
      };
      saveToLocalCache(CACHE_KEYS.WORKERS, updatedWorkers);
      
      // 2. Pre-increment local workersVersion (CF handles Firebase bump)
      preIncrementVersion('workersVersion', true);
      
      console.log(`Worker ${wid} added to cache successfully`);
      
    } catch (error) {
      console.error('Error adding worker to cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, preIncrementVersion]);

  /**
   * Edit worker details (called AFTER cloud function updates Firestore)
   * Can update: name, phoneNumber
   * CANNOT update: email (immutable)
   * 
   * @param {string} wid - Worker ID to edit in cache  
   * @param {object} updates - { name?, phoneNumber? }
   */
  const editWorker = useCallback(async (wid, updates) => {
    const role = getUserRole();
    const companyId = getCompanyId();
    
    if (role !== 'manager') {
      console.error('Only managers can edit workers');
      throw new Error('Only managers can edit workers');
    }
    
    if (!companyId) {
      console.error('No company name found');
      throw new Error('No company name found');
    }
    
    console.log(`?? Editing worker ${wid} in cache...`);
    
    try {
      // 1. Update local cache
      const currentWorker = workers[wid];
      if (!currentWorker) {
        throw new Error('Worker not found in cache');
      }
      const { password, ...safeUpdates } = updates || {};
      
      const updatedWorkerData = {
        ...currentWorker,
        ...safeUpdates,
        email: currentWorker.email // Email is immutable
      };
      
      const updatedWorkers = {
        ...workers,
        [wid]: updatedWorkerData
      };
      saveToLocalCache(CACHE_KEYS.WORKERS, updatedWorkers);
      
      // 2. Pre-increment local workersVersion (CF handles Firebase bump)
      preIncrementVersion('workersVersion', true);
      
      console.log(`Worker ${wid} updated in cache successfully`);
      
    } catch (error) {
      console.error('Error editing worker in cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, preIncrementVersion]);

  /**
   * Delete worker from cache (called AFTER cloud function deletes Auth user and Firestore docs)
   * Removes:
   * 1. Worker from local cache
   * 2. Increment cache version
   * 
   * @param {string} wid - Worker ID to delete from cache
   */
  const deleteWorker = useCallback(async (wid) => {
    const role = getUserRole();
    const companyId = getCompanyId();
    
    if (role !== 'manager') {
      console.error('Only managers can delete workers');
      throw new Error('Only managers can delete workers');
    }
    
    if (!companyId) {
      console.error('No company name found');
      throw new Error('No company name found');
    }
    
    console.log(`??? Deleting worker ${wid} from cache...`);
    
    try {
      // 1. Remove from local cache
      const { [wid]: deletedWorker, ...remainingWorkers } = workers;
      saveToLocalCache(CACHE_KEYS.WORKERS, remainingWorkers);
      
      // 2. Pre-increment local workersVersion (CF handles Firebase bump)
      preIncrementVersion('workersVersion', true);
      
      console.log(`Worker ${wid} deleted from cache successfully`);
      
    } catch (error) {
      console.error('Error deleting worker from cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, preIncrementVersion]);

  /**
   * Add document
   * manager/user/basic adds document ? Company cache, increment document version
   */
  const addDocument = useCallback(async (document) => {
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
   * Fetch all clients from companies/{companyId}/clients
   */
  const fetchClients = useCallback(async (companyId) => {
    try {
      const cName = companyId || getCompanyId();
      if (!cName) {
        console.warn('?? No company name for fetchClients');
        return [];
      }
      console.log('?? [FIREBASE READ] Fetching clients from Firebase...');
      const clientsRef = collection(db, 'companies', cName, 'clients');
      const snapshot = await getDocs(clientsRef);
      const clientsList = [];
      snapshot.forEach(d => {
        clientsList.push({ id: d.id, ...d.data() });
      });
      // Sort by numeric ID so newest clients appear last
      clientsList.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      saveToLocalCache(CACHE_KEYS.CLIENTS, clientsList);
      setClients(clientsList); // Update state immediately
      console.log(`? Fetched ${clientsList.length} clients`);
      return clientsList;
    } catch (error) {
      console.error('Error fetching clients:', error);
      return [];
    }
  }, [getCompanyId, saveToLocalCache]);

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
  const addClient = useCallback(async (clientData) => {
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
      const newClient = result.data.client;

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
      console.error('âŒ Error code:', error.code);
      console.error('âŒ Error message:', error.message);
      throw error;
    }
  }, [getCompanyId, clients, saveToLocalCache, preIncrementVersion]);

  /**
   * Update an existing client
   */
  const updateClient = useCallback(async (clientId, updates) => {
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
      
      // Cache version is already bumped by the Cloud Function
      
      console.log(`? Client ${clientId} updated`);
    } catch (error) {
      console.error('Error updating client:', error);
      throw error;
    }
  }, [getCompanyId, clients, saveToLocalCache]);

  /**
   * Delete a client via the deleteClientV1 Cloud Function.
   * The CF handles the Firestore delete and increments the company cache version,
   * so other devices (and the snapshot listener) are notified automatically.
   */
  const deleteClient = useCallback(async (clientId) => {
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
    _mmkvScopePrefix = '';
    
    // Reset state
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
    
    listenersActiveRef.current = false;
    
    console.log('? Cache cleared');
  }, []);

  /**
   * Download archived month data from Cloud Storage.
   * Archives are stored as: companies/{companyId}/archives/{YYYY}-{M}-{suffix}.json
   * where suffix is 'j' for finishedJobs and 'd' for documents.
   * 
   * Uses a local MMKV cache so repeated requests for the same archived month
   * don't re-download from Storage.
   * 
   * @param {string} companyId
   * @param {number} year 
   * @param {number} month - 1-indexed
   * @param {string} dataType - 'finishedJobs' or 'documents'
   * @returns {Array|null} - Parsed documents or null if archive doesn't exist
   */
  const fetchFromArchive = useCallback(async (companyId, year, month, dataType) => {
    const suffix = dataType === 'finishedJobs' ? 'j' : 'd';
    const archiveKey = `${year}-${month}-${suffix}`;
    const mmkvCacheKey = `archive_${companyId}_${archiveKey}`;
    
    // Check local MMKV cache first (avoid re-downloading)
    const cached = mmkvHelpers.getObject(mmkvCacheKey);
    if (cached !== null) {
      console.log(`?? Archive ${archiveKey} loaded from local cache (${cached.length} docs)`);
      return cached;
    }
    
    // Download from Cloud Storage
    const storagePath = `companies/${companyId}/archives/${archiveKey}.json`;
    console.log(`?? Downloading archive from Storage: ${storagePath}`);
    
    try {
      const ref = firebaseStorage().ref(storagePath);
      const url = await ref.getDownloadURL();
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const jsonText = await response.text();
      const documents = JSON.parse(jsonText);
      
      console.log(`?? Downloaded archive ${archiveKey}: ${documents.length} docs (${(jsonText.length / 1024).toFixed(1)} KB)`);
      
      // Cache locally in MMKV (so we don't re-download)
      mmkvHelpers.setObject(mmkvCacheKey, documents);
      
      return documents;
    } catch (error) {
      // storage/object-not-found means this month was never archived
      if (error.code === 'storage/object-not-found' || error.message?.includes('404')) {
        console.log(`?? No archive found for ${archiveKey} (not yet archived or no data)`);
        return null;
      }
      console.error(`? Error downloading archive ${archiveKey}:`, error);
      return null;
    }
  }, []);

  /**
   * Get data for a specific month with 3-tier smart caching:
   * 
   * Tier 1 (0-90 days): MMKV local cache
   * Tier 2 (90-180 days): Firestore live query
   * Tier 3 (180+ days): Cloud Storage JSON archives
   * 
   * Flow for months outside cache:
   *   1. Query Firestore first
   *   2. If Firestore returns 0 docs AND month is > ~6 months old ? try Storage archive
   *   3. If Storage archive exists ? return archived data
   *   4. If nothing found anywhere ? return empty array (no data for this month)
   * 
   * @param {Date} monthDate - Any date within the target month
   * @param {string} dataType - 'finishedJobs' or 'documents'
   * @returns {Array} - Data for the requested month
   */
  const getDataForMonth = useCallback(async (monthDate, dataType) => {
    const role = getUserRole();
    const uid = getUid();
    const wid = getWid();
    const companyId = getCompanyId();
    
    // Calculate month boundaries
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    
    // Calculate cache boundary (90 days ago from now)
    const now = new Date();
    const cacheStartDate = new Date(now.getTime() - CACHE_EXPIRY_MS);
    
    // Determine data source based on date range
    const monthStartMs = monthStart.getTime();
    const monthEndMs = monthEnd.getTime();
    const cacheStartMs = cacheStartDate.getTime();
    const nowMs = now.getTime();
    
    // Get cached data based on type and role (unified jobs collection)
    let cachedData = [];
    if (dataType === 'finishedJobs') {
      const allJobs = role === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter(j => j.status === 'finished');
    } else if (dataType === 'documents') {
      cachedData = documents;
    }
    
    // Case 1: Month is completely within cache range (0-90 days)
    if (monthStartMs >= cacheStartMs && monthEndMs <= nowMs) {
      console.log(`?? Month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()} is fully within cache range`);
      
      const dateField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
      return cachedData.filter(item => {
        const itemDate = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return itemDate >= monthStartMs && itemDate <= monthEndMs;
      });
    }
    
    // Case 2: Month is partially within cache range
    if (monthEndMs >= cacheStartMs && monthStartMs < cacheStartMs) {
      console.log(`?? Month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()} is partially in cache, fetching missing data...`);
      
      const dateField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
      
      // Get data from cache
      const cachedMonthData = cachedData.filter(item => {
        const itemDate = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return itemDate >= cacheStartMs && itemDate <= monthEndMs;
      });
      
      // Query Firebase for missing data (the portion before cache boundary)
      try {
        let q;
        
        if (dataType === 'finishedJobs') {
          const jobsRef = collection(db, 'companies', companyId, 'jobs');
          if (role == 'worker') {
            q = query(jobsRef,
              where('status', '==', 'finished'),
              where('finishedAt', '>=', monthStart.toISOString()),
              where('finishedAt', '<', cacheStartDate.toISOString()),
              where('wid', '==', wid)
            );
          } else {
            q = query(jobsRef,
              where('status', '==', 'finished'),
              where('finishedAt', '>=', monthStart.toISOString()),
              where('finishedAt', '<', cacheStartDate.toISOString())
            );
          }
        } else if (dataType === 'documents') {
          const documentsRef = collection(db, 'companies', companyId, 'documents');
          q = query(documentsRef,
            where('createdAt', '>=', monthStart.toISOString()),
            where('createdAt', '<', cacheStartDate.toISOString())
          );
        }
        
        const snapshot = await getDocs(q);
        const firebaseData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        console.log(`Fetched ${firebaseData.length} missing records from Firebase for month ${monthDate.getMonth() + 1}`);
        
        return [...cachedMonthData, ...firebaseData];
      } catch (error) {
        console.error('Error fetching partial month data:', error);
        return cachedMonthData;
      }
    }
    
    // Case 3: Month is completely outside cache range - try MMKV tier2 cache, then Firestore, then Storage
    console.log(`?? Month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()} is outside cache range`);
    
    // N4: Check Tier 2 MMKV cache first (5-min TTL)
    const tier2Key = `${CACHE_KEYS.TIER2_CACHE_PREFIX}${dataType}_${monthDate.getFullYear()}_${monthDate.getMonth() + 1}`;
    const tier2Cached = mmkvHelpers.getObject(tier2Key);
    if (tier2Cached && tier2Cached._ts && (Date.now() - tier2Cached._ts) < TIER2_CACHE_TTL_MS) {
      console.log(`?? Tier 2 cache hit for ${tier2Key} (${tier2Cached.data.length} docs)`);
      return tier2Cached.data;
    }
    
    try {
      let q;
      
      if (dataType === 'finishedJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (role == 'worker') {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', monthStart.toISOString()),
            where('finishedAt', '<=', monthEnd.toISOString()),
            where('wid', '==', wid)
          );
        } else {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', monthStart.toISOString()),
            where('finishedAt', '<=', monthEnd.toISOString())
          );
        }
      } else if (dataType === 'documents') {
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        q = query(documentsRef,
          where('createdAt', '>=', monthStart.toISOString()),
          where('createdAt', '<=', monthEnd.toISOString())
        );
      }
      
      const snapshot = await getDocs(q);
      const firebaseData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // If Firestore returned data, use it (data is still in Firestore, not yet archived)
      if (firebaseData.length > 0) {
        console.log(`?? Fetched ${firebaseData.length} records from Firestore for month ${monthDate.getMonth() + 1}`);
        // N4: Cache in Tier 2 MMKV with TTL
        mmkvHelpers.setObject(tier2Key, { data: firebaseData, _ts: Date.now() });
        return firebaseData;
      }
      
      // Firestore returned 0 docs - check if data might be archived in Storage
      // Only try Storage if the month is old enough to have been archived (~6+ months)
      const archiveBoundary = new Date(now.getTime() - ARCHIVE_BOUNDARY_MS);
      if (monthEndMs < archiveBoundary.getTime()) {
        console.log(`?? Month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()} may be archived, checking Cloud Storage...`);
        
        const archivedData = await fetchFromArchive(
          companyId,
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          dataType
        );
        
        if (archivedData && archivedData.length > 0) {
          // For non-manager roles, filter by user
          if (dataType === 'finishedJobs' && role !== 'manager') {
            const filtered = archivedData.filter(item => String(item.wid) === wid);
            console.log(`?? Filtered archived data: ${filtered.length}/${archivedData.length} docs for wid ${wid}`);
            return filtered;
          }
          if (dataType === 'documents' && role !== 'manager') {
            const filtered = archivedData.filter(item => item.createdByUid === uid);
            console.log(`?? Filtered archived data: ${filtered.length}/${archivedData.length} docs for user ${uid}`);
            return filtered;
          }
          
          console.log(`?? Returning ${archivedData.length} archived records for month ${monthDate.getMonth() + 1}`);
          return archivedData;
        }
      }
      
      // No data found anywhere
      console.log(`?? No data found for month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()}`);
      return [];
      
    } catch (error) {
      console.error('Error fetching month data:', error);
      return [];
    }
  }, [getUserRole, getUid, getWid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  /**
   * Get data for a date range with smart caching
   * Used for "Last 7 days", "Last month" filters
   */
  const getDataForDateRange = useCallback(async (startDate, endDate, dataType) => {
    const role = getUserRole();
    const uid = getUid();
    const wid = getWid();
    const companyId = getCompanyId();
    
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const cacheStartMs = getCacheStartDate().getTime();
    
    // Get cached data based on type and role (unified jobs collection)
    let cachedData = [];
    if (dataType === 'finishedJobs') {
      const allJobs = role === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter(j => j.status === 'finished');
    } else if (dataType === 'documents') {
      cachedData = documents;
    } else if (dataType === 'pendingJobs') {
      const allJobs = role === 'manager' ? companyJobs : jobs;
      cachedData = allJobs.filter(j => j.status === 'pending' || j.status === 'waiting');
    }
    
    const dateField = dataType === 'documents' ? 'createdAt' : 
                      dataType === 'pendingJobs' ? 'createdAt' : 'finishedAt';
    
    // If range is within cache, use cache only
    if (startMs >= cacheStartMs) {
      console.log(`?? Date range is within cache, using cached data`);
      return cachedData.filter(item => {
        const itemDate = item[dateField] ? new Date(item[dateField]).getTime() : 0;
        return itemDate >= startMs && itemDate <= endMs;
      });
    }
    
    // If range extends beyond cache, need to fetch from Firebase
    console.log(`?? Date range extends beyond cache, querying Firebase...`);
    
    // Get cached portion
    const cachedPortion = cachedData.filter(item => {
      const itemDate = item[dateField] ? new Date(item[dateField]).getTime() : 0;
      return itemDate >= cacheStartMs && itemDate <= endMs;
    });
    
    // Query Firebase for the portion outside cache
    try {
      let q;
      
      if (dataType === 'finishedJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (role == 'worker') {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', startDate.toISOString()),
            where('finishedAt', '<', getCacheStartDate().toISOString()),
            where('wid', '==', wid)
          );
        } else {
          q = query(jobsRef,
            where('status', '==', 'finished'),
            where('finishedAt', '>=', startDate.toISOString()),
            where('finishedAt', '<', getCacheStartDate().toISOString())
          );
        }
      } else if (dataType === 'documents') {
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        q = query(documentsRef,
          where('createdAt', '>=', startDate.toISOString()),
          where('createdAt', '<', getCacheStartDate().toISOString())
        );
      } else if (dataType === 'pendingJobs') {
        const jobsRef = collection(db, 'companies', companyId, 'jobs');
        if (role !== 'manager') {
          q = query(jobsRef,
            where('status', 'in', ['pending', 'waiting']),
            where('createdAt', '>=', startDate.toISOString()),
            where('createdAt', '<', getCacheStartDate().toISOString()),
            where('wid', '==', wid)
          );
        } else {
          q = query(jobsRef,
            where('status', 'in', ['pending', 'waiting']),
            where('createdAt', '>=', startDate.toISOString()),
            where('createdAt', '<', getCacheStartDate().toISOString())
          );
        }
      }
      
      const snapshot = await getDocs(q);
      const firebaseData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // If Firestore returned 0 docs for the pre-cache portion AND range extends past archive boundary,
      // we may need to check Storage for archived months
      if (firebaseData.length === 0 && dataType !== 'pendingJobs') {
        const archiveBoundary = new Date(Date.now() - ARCHIVE_BOUNDARY_MS);
        if (startMs < archiveBoundary.getTime()) {
          console.log(`?? Date range extends past archive boundary, checking Storage for archived months...`);
          
          const archivedDocs = [];
          // Iterate over each full month in the range that's past the archive boundary
          const archiveCheckStart = new Date(startDate);
          const archiveCheckEnd = new Date(Math.min(archiveBoundary.getTime(), cacheStartMs));
          
          let cursor = new Date(archiveCheckStart.getFullYear(), archiveCheckStart.getMonth(), 1);
          while (cursor < archiveCheckEnd) {
            const archived = await fetchFromArchive(
              companyId,
              cursor.getFullYear(),
              cursor.getMonth() + 1,
              dataType
            );
            
            if (archived && archived.length > 0) {
              // Filter by date range and user
              const dField = dataType === 'documents' ? 'createdAt' : 'finishedAt';
              const filtered = archived.filter(item => {
                const d = item[dField] ? new Date(item[dField]).getTime() : 0;
                return d >= startMs && d <= endMs;
              });
              
              // Apply user filter for non-managers
              if (role !== 'manager') {
                const userField = dataType === 'finishedJobs' ? 'wid' : 'createdByUid';
                const userValue = dataType === 'finishedJobs' ? wid : uid;
                const userFiltered = filtered.filter(item => String(item[userField]) === userValue);
                archivedDocs.push(...userFiltered);
              } else {
                archivedDocs.push(...filtered);
              }
            }
            
            // Move to next month
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          }
          
          if (archivedDocs.length > 0) {
            console.log(`?? Found ${archivedDocs.length} archived records for date range`);
            return [...cachedPortion, ...archivedDocs];
          }
        }
      }
      
      return [...cachedPortion, ...firebaseData];
    } catch (error) {
      console.error('Error fetching data for date range:', error);
      return cachedPortion;
    }
  }, [getUserRole, getUid, getWid, getCompanyId, jobs, companyJobs, documents, fetchFromArchive]);

  /**
   * Refresh specific cache data
   */
  const refreshCache = useCallback(async (field) => {
    const uid = getUid();
    const role = getUserRole();
    const companyId = getCompanyId();
    
    const data = await fetchDataFromFirebase(field, uid, companyId, role);
    if (data !== null) {
      const cacheKey = getCacheKeyForField(field);
      saveToLocalCache(cacheKey, data);
    }
  }, [getUid, getUserRole, getCompanyId, fetchDataFromFirebase, saveToLocalCache]);

  // Context value
  const value = {
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
  };

  return (
    <CacheContext.Provider value={value}>
      {children}
    </CacheContext.Provider>
  );
}

export { CACHE_KEYS };
