/**
 * CacheContext.js - Comprehensive MMKV-based caching system with granular document-level versioning
 * 
 * Document ID Prefixes (for type detection):
 * - p_XXXXX = PendingJob (created by manager, assigned to worker)
 * - f_XXXXX = FinishedJob (completed job, approved by manager or created by user)
 * - d_XXXXX = Document (taxInvoice, priceProposal, refund, returnCertificate)
 * 
 * Cache Structure (Firestore - document-level versioning):
 * - Standard fields have version numbers: { profile: 1, inventory: 5, workers: 2, business_info: 1 }
 * - Individual documents have version numbers: { p_ABC12: 1, f_XYZ99: 3, d_QWE45: 1 }
 * 
 * Example cache documents:
 * - User cache ({uid}/cache): { profile: 1, inventory: 50, f_ABC12: 1, f_XYZ99: 2 }
 * - Company cache (companies/{companyId}/business_data/cache): 
 *   { workers: 2, business_info: 1, p_ABC12: 1, f_XYZ99: 2, d_QWE45: 1 }
 * 
 * Document Type Detection:
 * - Primary: ID prefix (p_, f_, d_)
 * - Fallback (legacy): field-based detection
 *   - PendingJob: has 'assignedBy' field and no 'finishedAt'
 *   - FinishedJob: has 'finishedAt' field
 *   - Document: has 'type' field (taxInvoice, priceProposal, refund, returnCertificate)
 * 
 * Granular Fetching:
 * - Only fetches individual documents that are missing or have version mismatches
 * - If 99 jobs are cached and 1 new job is added, only that 1 job is fetched
 * - Drastically reduces Firebase reads and network usage
 * 
 * Cache Duration: 90 days
 * - finishedJobs: delete when finishedAt > 90 days
 * - documents: delete when createdAt > 90 days
 * 
 * Firestore Cache Docs:
 * - Manager personal: {uid}/cache (profile, inventory)
 * - Company: companies/{companyId}/business_data/cache (workers, business_info, clients, all jobs/documents)
 * - Worker: {uid}/cache (profile, inventory, clients, pendingJobs, finishedJobs)
 * - User: {uid}/cache (profile, inventory, clients, finishedJobs, business_info, documents)
 * - Basic: {uid}/cache (profile, clients, business_info, documents) - NO inventory, NO jobs
 * 
 * Listener Setup by Role:
 * - Manager: 2 listeners (user cache: profile/inventory, company cache: workers/business_info/clients/jobs/documents)
 * - Worker: 1 listener (user cache: profile/inventory/clients/pendingJobs/finishedJobs)
 * - User: 1 listener (user cache: profile/inventory/clients/finishedJobs/business_info/documents)
 * - Basic: 1 listener (user cache: profile/clients/business_info/documents - no inventory, no jobs)
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { db, auth, storage as firebaseStorage, doc, getDoc, setDoc, onSnapshot, updateDoc, collection, getDocs, query, where, orderBy, limit, writeBatch, FieldValue, functions, httpsCallable } from '../firebase';
import { getDocTypeFromId } from '../utils/helpers';
import { useAppStateListener } from '../hooks/useAppStateListener';

// MMKV v4.1.1 - https://github.com/mrousavy/react-native-mmkv
import { createMMKV } from 'react-native-mmkv';

// Create MMKV storage instance
export const storage = createMMKV({
  id: 'smart-job-cache'
});

console.log('? MMKV initialized successfully');

// For backwards compatibility
export const getStorage = () => storage;

// Cache keys for MMKV local storage
const CACHE_KEYS = {
  // User data
  PROFILE: 'cache_profile',
  INVENTORY: 'cache_inventory',
  
  // Jobs
  PENDING_JOBS: 'cache_pending_jobs',
  FINISHED_JOBS: 'cache_finished_jobs',
  
  // Company data (for managers)
  WORKERS: 'cache_workers',
  COMPANY_PENDING_JOBS: 'cache_company_pending_jobs',
  COMPANY_FINISHED_JOBS: 'cache_company_finished_jobs',
  
  // Business data
  DOCUMENTS: 'cache_documents',
  HAS_BUSINESS_INFO: 'cache_has_business_info',
  
  // Clients
  CLIENTS: 'cache_clients',
  
  // Subscription
  SUBSCRIPTION: 'cache_subscription',
  
  // Version tracking (maps documentId to version)
  CACHE_VERSIONS: 'cache_versions',
  COMPANY_CACHE_VERSIONS: 'cache_company_versions',
  
  // Metadata
  LAST_SYNC: 'cache_last_sync',
  USER_ROLE: 'cache_user_role',
  UID: 'cache_uid',
  COMPANY_ID: 'cache_company_id',
};

// 90 days in milliseconds
const CACHE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

// 180 days in milliseconds (approximate archive boundary - 6 months)
const ARCHIVE_BOUNDARY_MS = 180 * 24 * 60 * 60 * 1000;

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

// P2-4: Scope prefix for MMKV keys — prevents cross-user cache leaks
let _mmkvScopePrefix = '';

/**
 * Set the MMKV scope prefix (called on auth state change).
 * After calling this, all cache reads/writes are namespaced by uid:companyId.
 */
function setMmkvScope(uid, companyId) {
  _mmkvScopePrefix = (uid && companyId) ? `${uid}:${companyId}:` : uid ? `${uid}:` : '';
}

/** Resolve a cache key to its scoped form. Identity keys (UID, COMPANY_ID, USER_ROLE) are not scoped. */
const IDENTITY_KEYS = new Set([CACHE_KEYS.UID, CACHE_KEYS.COMPANY_ID, CACHE_KEYS.USER_ROLE]);
function scopedKey(key) {
  if (IDENTITY_KEYS.has(key)) return key; // identity is global
  return _mmkvScopePrefix + key;
}

// Helper functions for MMKV
const mmkvHelpers = {
  getString: (key) => {
    try {
      return storage.getString(scopedKey(key)) || null;
    } catch (e) {
      console.error(`MMKV getString error for ${key}:`, e);
      return null;
    }
  },
  
  setString: (key, value) => {
    try {
      storage.set(scopedKey(key), value);
      return true;
    } catch (e) {
      console.error(`MMKV setString error for ${key}:`, e);
      return false;
    }
  },
  
  getObject: (key) => {
    try {
      const str = storage.getString(scopedKey(key));
      return str ? JSON.parse(str) : null;
    } catch (e) {
      console.error(`MMKV getObject error for ${key}:`, e);
      return null;
    }
  },
  
  setObject: (key, value) => {
    try {
      storage.set(scopedKey(key), JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`MMKV setObject error for ${key}:`, e);
      return false;
    }
  },
  
  delete: (key) => {
    try {
      storage.remove(scopedKey(key));
      return true;
    } catch (e) {
      console.error(`MMKV delete error for ${key}:`, e);
      return false;
    }
  },
  
  clearAll: () => {
    try {
      storage.clearAll();
      return true;
    } catch (e) {
      console.error('MMKV clearAll error:', e);
      return false;
    }
  },
};

/**
 * Get the date that marks the start of the cache range (90 days ago)
 */
const getCacheStartDate = () => {
  return new Date(Date.now() - CACHE_EXPIRY_MS);
};

/**
 * Check if a date is within the 90-day cache range
 */
const isWithinCacheRange = (date) => {
  if (!date) return false;
  const dateMs = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return dateMs >= getCacheStartDate().getTime();
};

/**
 * Determine document type based on ID prefix (primary) or fields (fallback)
 * ID Prefixes:
 * - p_ = PendingJob
 * - f_ = FinishedJob  
 * - d_ = Document
 * Fallback (for legacy IDs without prefix):
 * - PendingJob: has 'assignedBy' field and no 'finishedAt'
 * - FinishedJob: has 'finishedAt' field
 * - Document: has 'type' field (taxInvoice, priceProposal, refund, returnCertificate)
 */
const getDocumentType = (docData) => {
  // First try to detect from ID prefix
  if (docData.id) {
    const typeFromId = getDocTypeFromId(docData.id);
    if (typeFromId !== 'unknown') return typeFromId;
  }
  
  // Fallback to field-based detection for legacy documents
  if (docData.assignedBy && !docData.finishedAt) return 'pendingJob';
  if (docData.finishedAt) return 'finishedJob';
  if (docData.type && ['taxInvoice', 'priceProposal', 'refund', 'returnCertificate'].includes(docData.type)) return 'document';
  return 'unknown';
};

export function CacheProvider({ children }) {
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [pendingJobs, setPendingJobs] = useState([]);
  const [finishedJobs, setFinishedJobs] = useState([]);
  const [workers, setWorkers] = useState({});
  const [companyPendingJobs, setCompanyPendingJobs] = useState([]);
  const [companyFinishedJobs, setCompanyFinishedJobs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [cacheVersions, setCacheVersions] = useState({});
  const [companyCacheVersions, setCompanyCacheVersions] = useState({});
  
  // Refs for cleanup
  const unsubscribeRef = useRef(null);
  const companyUnsubscribeRef = useRef(null);
  const listenersActiveRef = useRef(false); // Track if listeners are currently active
  
  // Get current user info from cache (canonical names)
  const getUid = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.UID), []);
  const getUserRole = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.USER_ROLE), []);
  const getCompanyId = useCallback(() => mmkvHelpers.getString(CACHE_KEYS.COMPANY_ID), []);
  // Backward-compatible aliases (deprecated � use getUid/getCompanyId)
  const getUsername = getUid;
  const getCompanyName = getCompanyId;

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
   * For finishedJobs: based on finishedAt
   * For documents: based on createdAt
   * IMPORTANT: Also deletes expired document IDs from Firebase cache docs
   * 
   * Uses whole-day boundary: calculates the cutoff date (90 days ago), truncates to
   * the start of that day (00:00:00), and deletes ALL items from that day and before.
   * This ensures all data for the same day is cleaned up in one go, preventing
   * repeated partial cleanups on each login.
   */
  const cleanupExpiredCache = useCallback(async (data, type, uid, companyId, role) => {
    // Calculate the cutoff: 90 days ago, truncated to start of day (00:00:00.000)
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - CACHE_EXPIRY_MS);
    // Truncate to start of day (midnight) - delete everything from this day and before
    cutoffDate.setHours(0, 0, 0, 0);
    const cutoffMs = cutoffDate.getTime();
    
    const expiredIds = [];
    
    const filteredData = data.filter(item => {
      let dateField;
      if (type === 'documents') {
        dateField = item.createdAt;
      } else if (type === 'finishedJobs') {
        dateField = item.finishedAt;
      } else {
        return true; // Keep if not finishedJobs or documents
      }
      
      if (!dateField) return true; // Keep if no date field
      
      const itemDate = dateField.toDate ? dateField.toDate().getTime() : new Date(dateField).getTime();
      // Delete items from the cutoff day and before (whole-day boundary)
      const isExpired = itemDate < cutoffMs;
      
      if (isExpired && item.id) {
        expiredIds.push(item.id);
      }
      
      return !isExpired;
    });
    
    // Delete expired IDs from Firebase cache docs
    if (expiredIds.length > 0 && uid) {
      console.log(`??? Deleting ${expiredIds.length} expired ${type} from cache docs:`, expiredIds.join(', '));
      
      try {
        const batch = writeBatch(db);
        
        // Determine which cache doc to update based on role
        if (role === 'manager') {
          // Manager: delete from company cache
          const companyCacheRef = doc(db, 'companies', companyId, 'business_data', 'cache');
          const deleteFields = {};
          expiredIds.forEach(id => {
            deleteFields[id] = FieldValue.delete();
          });
          batch.update(companyCacheRef, deleteFields);
        } else if (role === 'worker') {
          // Worker: delete from user cache
          const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
          const deleteFields = {};
          expiredIds.forEach(id => {
            deleteFields[id] = FieldValue.delete();
          });
          batch.update(userCacheRef, deleteFields);
        } else {
          // User: delete from user cache (and company cache for documents)
          const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
          const deleteFields = {};
          expiredIds.forEach(id => {
            deleteFields[id] = FieldValue.delete();
          });
          batch.update(userCacheRef, deleteFields);
        }
        
        await batch.commit();
        console.log('? Expired IDs deleted from cache docs');
      } catch (error) {
        console.error('Error deleting expired IDs from cache docs:', error);
      }
    }
    
    return { filteredData, expiredIds };
  }, []);

  /**
   * Load data from local cache
   */
  const loadFromLocalCache = useCallback(() => {
    console.log('?? [CACHE READ] Loading from local MMKV cache...');
    
    const cachedUid = mmkvHelpers.getString(CACHE_KEYS.UID);
    const cachedRole = mmkvHelpers.getString(CACHE_KEYS.USER_ROLE);
    const cachedCompanyId = mmkvHelpers.getString(CACHE_KEYS.COMPANY_ID);

    // P2-4: Set scope BEFORE reading any scoped keys
    setMmkvScope(cachedUid, cachedCompanyId);

    const cachedProfile = mmkvHelpers.getObject(CACHE_KEYS.PROFILE);
    const cachedInventory = mmkvHelpers.getObject(CACHE_KEYS.INVENTORY);
    const cachedPendingJobs = mmkvHelpers.getObject(CACHE_KEYS.PENDING_JOBS);
    const cachedFinishedJobs = mmkvHelpers.getObject(CACHE_KEYS.FINISHED_JOBS);
    const cachedWorkers = mmkvHelpers.getObject(CACHE_KEYS.WORKERS);
    const cachedCompanyPendingJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_PENDING_JOBS);
    const cachedCompanyFinishedJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_FINISHED_JOBS);
    const cachedDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS);
    const cachedHasBusinessInfo = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO);
    const cachedClients = mmkvHelpers.getObject(CACHE_KEYS.CLIENTS);
    const cachedSubscription = mmkvHelpers.getObject(CACHE_KEYS.SUBSCRIPTION);
    const cachedVersions = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS);
    const cachedCompanyVersions = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_CACHE_VERSIONS);
    
    if (cachedProfile) setProfile(cachedProfile);
    if (cachedInventory) setInventory(cachedInventory);
    if (cachedPendingJobs) setPendingJobs(cachedPendingJobs);
    if (cachedFinishedJobs) setFinishedJobs(cachedFinishedJobs);
    if (cachedWorkers) setWorkers(cachedWorkers);
    if (cachedCompanyPendingJobs) setCompanyPendingJobs(cachedCompanyPendingJobs);
    if (cachedCompanyFinishedJobs) setCompanyFinishedJobs(cachedCompanyFinishedJobs);
    if (cachedDocuments) setDocuments(cachedDocuments);
    if (cachedClients) setClients(cachedClients);
    if (cachedSubscription) setSubscription(cachedSubscription);
    if (cachedVersions) setCacheVersions(cachedVersions);
    if (cachedCompanyVersions) setCompanyCacheVersions(cachedCompanyVersions);
    
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
      case CACHE_KEYS.PENDING_JOBS:
        setPendingJobs(data);
        break;
      case CACHE_KEYS.FINISHED_JOBS:
        setFinishedJobs(data);
        break;
      case CACHE_KEYS.WORKERS:
        setWorkers(data);
        break;
      case CACHE_KEYS.COMPANY_PENDING_JOBS:
        setCompanyPendingJobs(data);
        break;
      case CACHE_KEYS.COMPANY_FINISHED_JOBS:
        setCompanyFinishedJobs(data);
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
      case CACHE_KEYS.COMPANY_CACHE_VERSIONS:
        setCompanyCacheVersions(data);
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
              // Workers are now keyed by UID in Firestore
              const workerUid = docSnap.id;
              workersData[workerUid] = {
                ...workerDoc,
                uid: workerUid,
                workerId: workerDoc.workerId || workerUid,
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
          const subRef = doc(db, 'companies', companyId, 'business_data', 'subscription');
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
   * Fetch a single document by ID
   * Uses ID prefix to determine collection:
   * - p_ = PendingJobs
   * - f_ = finishedJobs
   * - d_ = documents
   */
  const fetchDocumentById = useCallback(async (docId, uid, companyId, role) => {
    console.log(`?? [FIREBASE READ] Fetching document ${docId} from Firebase...`);
    
    try {
      const docType = getDocTypeFromId(docId);
      let docRef;
      let docSnap;
      
      if (docType === 'pendingJob') {
        docRef = doc(db, 'companies', companyId, 'PendingJobs', docId);
        docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
      } else if (docType === 'finishedJob') {
        docRef = doc(db, 'companies', companyId, 'finishedJobs', docId);
        docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
      } else if (docType === 'document') {
        docRef = doc(db, 'companies', companyId, 'documents', docId);
        docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
      } else {
        // Legacy fallback - try all collections
        console.log(`?? Unknown prefix for ${docId}, trying all collections...`);
        
        // Try pending jobs first
        docRef = doc(db, 'companies', companyId, 'PendingJobs', docId);
        docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
        
        // Try finished jobs
        docRef = doc(db, 'companies', companyId, 'finishedJobs', docId);
        docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
        
        // Try documents
        docRef = doc(db, 'companies', companyId, 'documents', docId);
        docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return { id: docId, ...docSnap.data() };
        }
      }
      
      console.warn(`Document ${docId} not found in any collection`);
      return null;
    } catch (error) {
      console.error(`Error fetching document ${docId}:`, error);
      return null;
    }
  }, []);

  /**
   * Fetch all recent jobs (within 90 days) from Firebase
   * Used on first initialization when no local cache exists
   */
  const fetchAllRecentJobs = useCallback(async (uid, companyId, role) => {
    // Dev role has no jobs or documents - return early
    if (role === 'dev') {
      console.log('?? Dev role: skipping all jobs/documents fetch (early return)');
      return { pendingJobsData: [], finishedJobsData: [], documentsData: [] };
    }
    
    console.log('?? [FIREBASE READ] Fetching all recent jobs from Firebase (first-time init)...');
    const ninetyDaysAgo = getCacheStartDate().toISOString();
    
    try {
      let pendingJobsData = [];
      let finishedJobsData = [];
      let documentsData = [];
      
      if (role === 'manager') {
        // Manager: fetch all company pending jobs
        const pendingRef = collection(db, 'companies', companyId, 'PendingJobs');
        const pendingSnapshot = await getDocs(pendingRef);
        pendingJobsData = pendingSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${pendingJobsData.length} pending jobs for manager`);
        
        // Manager: fetch all company finished jobs (within 90 days)
        const finishedRef = collection(db, 'companies', companyId, 'finishedJobs');
        const finishedQuery = query(finishedRef, where('finishedAt', '>=', ninetyDaysAgo));
        const finishedSnapshot = await getDocs(finishedQuery);
        finishedJobsData = finishedSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${finishedJobsData.length} finished jobs for manager`);
        
        // Manager: fetch all company documents (within 90 days)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(documentsRef, where('createdAt', '>=', ninetyDaysAgo));
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${documentsData.length} documents for manager`);
        
      } else if (role === 'worker') {
        // Worker: fetch assigned pending jobs
        const pendingRef = collection(db, 'companies', companyId, 'PendingJobs');
        const pendingQuery = query(pendingRef, where('completedBy', '==', uid));
        const pendingSnapshot = await getDocs(pendingQuery);
        pendingJobsData = pendingSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${pendingJobsData.length} pending jobs for worker`);
        
        // Worker: fetch own finished jobs (within 90 days)
        const finishedRef = collection(db, 'companies', companyId, 'finishedJobs');
        const finishedQuery = query(
          finishedRef, 
          where('completedBy', '==', uid),
          where('finishedAt', '>=', ninetyDaysAgo)
        );
        const finishedSnapshot = await getDocs(finishedQuery);
        finishedJobsData = finishedSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${finishedJobsData.length} finished jobs for worker`);
        
      } else if (role === 'user') {
        // User: fetch own finished jobs (within 90 days)
        const finishedRef = collection(db, 'companies', companyId, 'finishedJobs');
        const finishedQuery = query(
          finishedRef,
          where('finishedAt', '>=', ninetyDaysAgo)
        );
        const finishedSnapshot = await getDocs(finishedQuery);
        finishedJobsData = finishedSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${finishedJobsData.length} finished jobs for user`);
        
        // User: fetch own documents (within 90 days)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(
          documentsRef,
          where('createdAt', '>=', ninetyDaysAgo)
        );
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${documentsData.length} documents for user`);
      } else if (role === 'basic') {
        // Basic: fetch only documents (NO jobs, NO inventory)
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsQuery = query(
          documentsRef,
          where('createdAt', '>=', ninetyDaysAgo)
        );
        const documentsSnapshot = await getDocs(documentsQuery);
        documentsData = documentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`?? Fetched ${documentsData.length} documents for basic user`);
        // Basic role has no pending/finished jobs - keep arrays empty
      } else if (role === 'dev') {
        // Dev role: NO jobs, NO documents (support-only role)
        console.log('?? Dev role: skipping all jobs/documents fetch');
        // All arrays stay empty
      }
      
      return { pendingJobsData, finishedJobsData, documentsData };
    } catch (error) {
      console.error('Error fetching all recent jobs:', error);
      return { pendingJobsData: [], finishedJobsData: [], documentsData: [] };
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
      'pendingJobs': CACHE_KEYS.PENDING_JOBS,
      'finishedJobs': CACHE_KEYS.FINISHED_JOBS,
      'workers': CACHE_KEYS.WORKERS,
      'companyPendingJobs': CACHE_KEYS.COMPANY_PENDING_JOBS,
      'companyFinishedJobs': CACHE_KEYS.COMPANY_FINISHED_JOBS,
      'documents': CACHE_KEYS.DOCUMENTS,
      'clients': CACHE_KEYS.CLIENTS,
    };
    return mapping[field] || field;
  };

  /**
   * Set up real-time listeners for cache version changes (snapshot listeners)
   * Based on role:
   * - Manager: 2 listeners (user cache: profile/inventory, company cache: workers/business_info/clients/jobs/documents)
   * - Worker: 1 listener (user cache only: profile/inventory/clients/pendingJobs/finishedJobs)
   * - User: 1 listener (user cache only: profile/inventory/clients/finishedJobs/business_info/documents)
   */
  const setupCacheListeners = useCallback((uid, role, companyId) => {
    console.log(`?? Setting up cache listeners for ${role}...`);
    
    // Dev role doesn't need cache listeners
    if (role === 'dev') {
      console.log('?? Dev role: skipping cache listeners (support-only role)');
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
    
    // =====================================================
    // USER CACHE LISTENER (for all roles)
    // =====================================================
    const userCacheRef = doc(db, 'users', uid, 'data', 'cache');
    unsubscribeRef.current = onSnapshot(userCacheRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      
      const remoteVersions = snapshot.data();
      const localVersions = mmkvHelpers.getObject(CACHE_KEYS.CACHE_VERSIONS) || {};
      
      console.log('?? User cache snapshot received:', Object.keys(remoteVersions).length, 'fields');
      console.log('📋 Remote fields:', Object.keys(remoteVersions).join(', '));
      console.log('💾 Local versions tracked:', Object.keys(localVersions).join(', '));
      
      // Define standard fields based on role for user cache
      // Basic role: only profile (no inventory, no business_info cached)
      let standardFields = role === 'basic' ? ['profile'] : ['profile', 'inventory'];
      // All roles track subscription version in user cache
      standardFields.push('subscription');
      // All non-manager roles track clients version in user cache
      if (role !== 'manager') {
        standardFields.push('clients');
      }
      
      // Check standard fields for version changes
      for (const field of standardFields) {
        const remoteVersion = remoteVersions[field] || 0;
        const localVersion = localVersions[field] || 0;
        
        if (remoteVersion > localVersion) {
          console.log(`?? Version mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
          // subscription is fetched from company path, not user path
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
      
      // Check for standard fields that exist locally but are missing from remote (deleted fields)
      for (const field of standardFields) {
        const hasRemoteField = remoteVersions.hasOwnProperty(field);
        const remoteVersion = remoteVersions[field];
        const localVersion = localVersions[field];
        
        
        if (localVersion && !hasRemoteField) {
          console.log(`❌ Field ${field} exists locally but not in remote cache - deleting`);
          const cacheKey = getCacheKeyForField(field);
          mmkvHelpers.delete(cacheKey);
          delete localVersions[field];
          // Clear state if it's subscription
          if (field === 'subscription') {
            setSubscription(null);
          }
        }
      }
      
      // For workers, users, and basic role, check document versions in user cache
      // Basic role: only documents (no pending/finished jobs)
      if (role === 'worker' || role === 'user' || role === 'basic') {
        const documentFields = Object.keys(remoteVersions).filter(key => 
          !['profile', 'inventory', 'business_info', 'clients', 'subscription', 'lastUpdated'].includes(key)
        );
        // Basic role doesn't have jobs, only documents
        let localPendingJobs = role === 'basic' ? [] : (mmkvHelpers.getObject(CACHE_KEYS.PENDING_JOBS) || []);
        let localFinishedJobs = role === 'basic' ? [] : (mmkvHelpers.getObject(CACHE_KEYS.FINISHED_JOBS) || []);
        let localDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
        
        const documentsToFetch = [];
        const documentsToDelete = [];
        
        // Check for documents to fetch
        for (const docId of documentFields) {
          const remoteVersion = remoteVersions[docId] || 0;
          const localVersion = localVersions[docId] || 0;
          
          const existsInPending = localPendingJobs.some(j => j.id === docId);
          const existsInFinished = localFinishedJobs.some(j => j.id === docId);
          const existsInDocuments = localDocuments.some(c => c.id === docId);
          const existsLocally = existsInPending || existsInFinished || existsInDocuments;
          
          if (!existsLocally || remoteVersion > localVersion) {
            console.log(`?? Document ${docId} needs fetch: exists=${existsLocally}, local=${localVersion}, remote=${remoteVersion}`);
            documentsToFetch.push(docId);
            localVersions[docId] = remoteVersion;
          }
        }
        
        // Check for documents to delete
        const allLocalDocIds = [
          ...localPendingJobs.map(j => j.id),
          ...localFinishedJobs.map(j => j.id),
          ...localDocuments.map(c => c.id)
        ];
        
        for (const localDocId of allLocalDocIds) {
          if (!documentFields.includes(localDocId) && !remoteVersions[localDocId]) {
            console.log(`??? Document ${localDocId} exists locally but not in remote cache - marking for deletion`);
            documentsToDelete.push(localDocId);
            delete localVersions[localDocId];
          }
        }
        
        // Delete stale documents
        if (documentsToDelete.length > 0) {
          localPendingJobs = localPendingJobs.filter(j => !documentsToDelete.includes(j.id));
          localFinishedJobs = localFinishedJobs.filter(j => !documentsToDelete.includes(j.id));
          localDocuments = localDocuments.filter(c => !documentsToDelete.includes(c.id));
          
          saveToLocalCache(CACHE_KEYS.PENDING_JOBS, localPendingJobs);
          saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, localFinishedJobs);
          saveToLocalCache(CACHE_KEYS.DOCUMENTS, localDocuments);
        }
        
        // Fetch missing/outdated documents
        if (documentsToFetch.length > 0) {
          console.log(`?? Fetching ${documentsToFetch.length} documents:`, documentsToFetch.join(', '));
          
          for (const docId of documentsToFetch) {
            const docData = await fetchDocumentById(docId, uid, companyId, role);
            
            if (docData) {
              // For workers, only cache if assigned to them
              if (role === 'worker' && docData.completedBy !== uid) {
                continue;
              }
              
              const docType = getDocumentType(docData);
              
              if (docType === 'pendingJob') {
                const currentJobs = mmkvHelpers.getObject(CACHE_KEYS.PENDING_JOBS) || [];
                const updatedJobs = currentJobs.filter(j => j.id !== docId);
                updatedJobs.push(docData);
                saveToLocalCache(CACHE_KEYS.PENDING_JOBS, updatedJobs);
              } else if (docType === 'finishedJob') {
                if (isWithinCacheRange(docData.finishedAt)) {
                  const currentJobs = mmkvHelpers.getObject(CACHE_KEYS.FINISHED_JOBS) || [];
                  const updatedJobs = currentJobs.filter(j => j.id !== docId);
                  updatedJobs.push(docData);
                  saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, updatedJobs);
                }
              } else if (docType === 'document') {
                if (isWithinCacheRange(docData.createdAt)) {
                  const currentDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
                  const updatedDocuments = currentDocuments.filter(c => c.id !== docId);
                  updatedDocuments.push(docData);
                  saveToLocalCache(CACHE_KEYS.DOCUMENTS, updatedDocuments);
                }
              }
            }
          }
        }
      }
      
      // Save updated versions
      saveToLocalCache(CACHE_KEYS.CACHE_VERSIONS, localVersions);
      
    }, (error) => {
      console.error('User cache listener error:', error);
    });
    
    // =====================================================
    // COMPANY CACHE LISTENER (for managers only)
    // Workers and users don't need company cache listener
    // because their cache is updated directly when jobs are assigned/changed
    // =====================================================
    if (role === 'manager' && companyId) {
      const companyCacheRef = doc(db, 'companies', companyId, 'business_data', 'cache');
      companyUnsubscribeRef.current = onSnapshot(companyCacheRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        
        const remoteVersions = snapshot.data();
        const localVersions = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_CACHE_VERSIONS) || {};
        
        console.log('?? Company cache snapshot received:', Object.keys(remoteVersions).length, 'fields');
        
        // Check standard company fields (business_info excluded - fetched by Cloud Functions only)
        const standardCompanyFields = ['workers', 'clients'];
        
        for (const field of standardCompanyFields) {
          const remoteVersion = remoteVersions[field] || 0;
          const localVersion = localVersions[field] || 0;
          
          if (remoteVersion > localVersion) {
            console.log(`?? Company version mismatch for ${field}: local=${localVersion}, remote=${remoteVersion}`);
            const data = await fetchDataFromFirebase(field, uid, companyId, role);
            if (data !== null) {
              const cacheKey = getCacheKeyForField(field);
              saveToLocalCache(cacheKey, data);
            }
            localVersions[field] = remoteVersion;
          }
        }
        
        // Check for company fields that exist locally but are missing from remote (deleted fields)
        for (const field of standardCompanyFields) {
          const hasRemoteField = remoteVersions.hasOwnProperty(field);
          const remoteVersion = remoteVersions[field];
          const localVersion = localVersions[field];
          
          console.log(`🔍 Company checking deletion for ${field}: hasRemote=${hasRemoteField}, remoteVer=${remoteVersion}, localVer=${localVersion}`);
          
          if (localVersion && !hasRemoteField) {
            console.log(`❌ Company field ${field} exists locally but not in remote cache - deleting`);
            const cacheKey = getCacheKeyForField(field);
            mmkvHelpers.delete(cacheKey);
            delete localVersions[field];
          }
        }
        
        // Check individual document versions
        const documentFields = Object.keys(remoteVersions).filter(key => 
          !['workers', 'business_info', 'clients', 'subscription', 'lastUpdated'].includes(key)
        );
        
        let localCompanyPendingJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_PENDING_JOBS) || [];
        let localCompanyFinishedJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_FINISHED_JOBS) || [];
        let localDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
        
        const documentsToFetch = [];
        const documentsToDelete = [];
        
        // Check for documents to fetch
        for (const docId of documentFields) {
          const remoteVersion = remoteVersions[docId] || 0;
          const localVersion = localVersions[docId] || 0;
          
          const existsInPending = localCompanyPendingJobs.some(j => j.id === docId);
          const existsInFinished = localCompanyFinishedJobs.some(j => j.id === docId);
          const existsInDocuments = localDocuments.some(c => c.id === docId);
          const existsLocally = existsInPending || existsInFinished || existsInDocuments;
          
          if (!existsLocally || remoteVersion > localVersion) {
            console.log(`?? Company document ${docId} needs fetch: exists=${existsLocally}, local=${localVersion}, remote=${remoteVersion}`);
            documentsToFetch.push(docId);
            localVersions[docId] = remoteVersion;
          }
        }
        
        // Check for documents to delete
        const allLocalCompanyDocIds = [
          ...localCompanyPendingJobs.map(j => j.id),
          ...localCompanyFinishedJobs.map(j => j.id),
          ...localDocuments.map(c => c.id)
        ];
        
        for (const localDocId of allLocalCompanyDocIds) {
          if (!documentFields.includes(localDocId) && !remoteVersions[localDocId]) {
            console.log(`??? Company document ${localDocId} exists locally but not in remote cache - marking for deletion`);
            documentsToDelete.push(localDocId);
            delete localVersions[localDocId];
          }
        }
        
        // Delete stale documents
        if (documentsToDelete.length > 0) {
          localCompanyPendingJobs = localCompanyPendingJobs.filter(j => !documentsToDelete.includes(j.id));
          localCompanyFinishedJobs = localCompanyFinishedJobs.filter(j => !documentsToDelete.includes(j.id));
          localDocuments = localDocuments.filter(c => !documentsToDelete.includes(c.id));
          
          saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, localCompanyPendingJobs);
          saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, localCompanyFinishedJobs);
          saveToLocalCache(CACHE_KEYS.DOCUMENTS, localDocuments);
        }
        
        // Fetch missing/outdated documents
        if (documentsToFetch.length > 0) {
          console.log(`?? Fetching ${documentsToFetch.length} company documents:`, documentsToFetch.join(', '));
          
          for (const docId of documentsToFetch) {
            const docData = await fetchDocumentById(docId, uid, companyId, role);
            
            if (docData) {
              const docType = getDocumentType(docData);
              
              if (docType === 'pendingJob') {
                const currentJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_PENDING_JOBS) || [];
                const updatedJobs = currentJobs.filter(j => j.id !== docId);
                updatedJobs.push(docData);
                saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, updatedJobs);
              } else if (docType === 'finishedJob') {
                if (isWithinCacheRange(docData.finishedAt)) {
                  const currentJobs = mmkvHelpers.getObject(CACHE_KEYS.COMPANY_FINISHED_JOBS) || [];
                  const updatedJobs = currentJobs.filter(j => j.id !== docId);
                  updatedJobs.push(docData);
                  saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, updatedJobs);
                }
              } else if (docType === 'document') {
                if (isWithinCacheRange(docData.createdAt)) {
                  const currentDocuments = mmkvHelpers.getObject(CACHE_KEYS.DOCUMENTS) || [];
                  const updatedDocuments = currentDocuments.filter(c => c.id !== docId);
                  updatedDocuments.push(docData);
                  saveToLocalCache(CACHE_KEYS.DOCUMENTS, updatedDocuments);
                }
              }
            }
          }
        }
        
        // Save updated versions
        saveToLocalCache(CACHE_KEYS.COMPANY_CACHE_VERSIONS, localVersions);
        
      }, (error) => {
        console.error('Company cache listener error:', error);
      });
    }
    
    // Mark listeners as active
    listenersActiveRef.current = true;
    
    console.log(`? Cache listeners set up for ${role}`);
  }, [fetchDataFromFirebase, fetchDocumentById, saveToLocalCache]);

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
      
      // STEP 5: Migration check - if HAS_BUSINESS_INFO flag is missing, check Firestore once
      // This handles users upgrading from old cache version (which stored full businessInfo object)
      const existingFlag = mmkvHelpers.getString(CACHE_KEYS.HAS_BUSINESS_INFO);
      if (!existingFlag && role !== 'worker' && role !== 'dev' && companyId) {
        console.log(`?? HAS_BUSINESS_INFO flag missing (migration), checking Firestore...`);
        try {
          const bizRef = doc(db, 'companies', companyId, 'business_data', 'business_info');
          const bizDoc = await getDoc(bizRef);
          const exists = bizDoc.exists();
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, exists ? 'true' : 'false');
          console.log(`? Migration complete - business_info ${exists ? 'exists' : 'not found'}`);
        } catch (e) {
          console.warn('Migration check failed:', e.message);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, 'false');
        }
      }
      
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
          const subRef = doc(db, 'companies', companyId, 'business_data', 'subscription');
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
          const bizRef = doc(db, 'companies', companyId, 'business_data', 'business_info');
          const bizDoc = await getDoc(bizRef);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, bizDoc.exists() ? 'true' : 'false');
        } catch (e) {
          console.warn('Could not check business_info existence:', e.message);
          mmkvHelpers.setString(CACHE_KEYS.HAS_BUSINESS_INFO, 'false');
        }
      }
      
      // Fetch all recent jobs from Firebase
      console.log('?? Fetching all recent jobs for initial cache...');
      const { pendingJobsData, finishedJobsData, documentsData } = await fetchAllRecentJobs(uid, companyId, role);
      
      // Save fetched jobs to local cache
      if (role === 'manager') {
        saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, pendingJobsData);
        saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, finishedJobsData);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, []);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      } else if (role === 'worker') {
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, pendingJobsData);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, finishedJobsData);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
      } else if (role === 'basic') {
        // Basic role: NO jobs at all, only documents
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, []);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      } else if (role === 'dev') {
        // Dev role: NO jobs, NO documents (support-only)
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, []);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, []);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, []);
      } else {
        // User role
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, []);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, finishedJobsData);
        saveToLocalCache(CACHE_KEYS.DOCUMENTS, documentsData);
      }
      
      // Fetch clients for all roles (shared company collection)
      if (companyId) {
        console.log('?? Fetching clients for initial cache...');
        await fetchClients(companyId);
      }
      
      // IMPORTANT: Fetch remote cache docs to get correct version numbers
      console.log('?? Fetching remote cache docs for version numbers...');
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
        console.log(`?? User cache versions loaded: ${Object.keys(versions).length} fields`);
      }
      
      // Fetch company cache doc (for managers)
      if (role === 'manager' && companyId) {
        const companyCacheRef = doc(db, 'companies', companyId, 'business_data', 'cache');
        const companyCacheSnap = await getDoc(companyCacheRef);
        if (companyCacheSnap.exists()) {
          const companyCacheData = companyCacheSnap.data();
          Object.keys(companyCacheData).forEach(key => {
            if (key !== 'lastUpdated') {
              companyVersions[key] = companyCacheData[key];
            }
          });
          console.log(`?? Company cache versions loaded: ${Object.keys(companyVersions).length} fields`);
        }
      }
      
      // Save versions to local cache
      saveToLocalCache(CACHE_KEYS.CACHE_VERSIONS, versions);
      saveToLocalCache(CACHE_KEYS.COMPANY_CACHE_VERSIONS, companyVersions);
      
      // Set up listeners
      setupCacheListeners(uid, role, companyId);
      setIsInitialized(true);
      setIsLoading(false);
      
      console.log('? Initial cache populated with', pendingJobsData.length, 'pending,', finishedJobsData.length, 'finished jobs');
    } catch (error) {
      console.error('Error fetching fresh data:', error);
      setIsLoading(false);
    }
  }, [fetchDataFromFirebase, fetchAllRecentJobs, saveToLocalCache, setupCacheListeners, fetchClients]);

  /**
   * Update cache version in Firebase (increment by 1)
   * Can handle both standard fields (profile, inventory) and individual documents (job123, doc456)
   * 
   * IMPORTANT: Updates local version FIRST, then Firebase, to prevent unnecessary refetch
   * when snapshot listener fires (local version will already match remote)
   */
  const incrementCacheVersion = useCallback(async (fieldOrDocId, isCompanyCache = false) => {
    const uid = getUid();
    const companyId = getCompanyId();
    
    try {
      // STEP 1: Update local version FIRST (before Firebase write triggers snapshot)
      const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_CACHE_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
      const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
      const newVersion = (localVersions[fieldOrDocId] || 0) + 1;
      localVersions[fieldOrDocId] = newVersion;
      saveToLocalCache(localVersionsKey, localVersions);
      
      console.log(`?? Pre-incremented local ${fieldOrDocId} version to ${newVersion} in ${isCompanyCache ? 'company' : 'user'} cache`);
      
      // STEP 2: Then update Firebase directly
      const cacheRef = isCompanyCache
        ? doc(db, `companies/${companyId}/business_data/cache`)
        : doc(db, `users/${uid}/data/cache`);
      await updateDoc(cacheRef, { [fieldOrDocId]: FieldValue.increment(1) });
      
      console.log(`? Firebase ${fieldOrDocId} version incremented`);
    } catch (error) {
      console.error(`Error incrementing ${fieldOrDocId} version:`, error);
      // Rollback local version on error
      const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_CACHE_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
      const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
      localVersions[fieldOrDocId] = Math.max(0, (localVersions[fieldOrDocId] || 1) - 1);
      saveToLocalCache(localVersionsKey, localVersions);
    }
  }, [getUid, getCompanyId, saveToLocalCache]);

  /**
   * Delete a field from Firebase cache doc
   * Used when deleting jobs/documents or moving from pending to finished
   */
  const deleteCacheField = useCallback(async (fieldOrDocId, isCompanyCache = false) => {
    const uid = getUid();
    const companyId = getCompanyId();
    
    try {
      // Delete from local versions
      const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_CACHE_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
      const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
      delete localVersions[fieldOrDocId];
      saveToLocalCache(localVersionsKey, localVersions);
      
      // Delete field from Firebase cache doc directly
      const cacheRef = isCompanyCache
        ? doc(db, `companies/${companyId}/business_data/cache`)
        : doc(db, `users/${uid}/data/cache`);
      await updateDoc(cacheRef, { [fieldOrDocId]: FieldValue.delete() });
      
      console.log(`??? Deleted ${fieldOrDocId} from ${isCompanyCache ? 'company' : 'user'} cache`);
    } catch (error) {
      console.error(`Error deleting ${fieldOrDocId} from cache:`, error);
    }
  }, [getUid, getCompanyId, saveToLocalCache]);

  /**
   * Increment version for a specific document (job or document)
   * This is called when creating, updating, or deleting a job/document
   */
  const incrementDocumentVersion = useCallback(async (docId, isCompanyCache = true) => {
    await incrementCacheVersion(docId, isCompanyCache);
  }, [incrementCacheVersion]);

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
    if (!uid) {
      console.error('Cannot update inventory: no uid');
      return;
    }
    
    // 1. Update local cache FIRST
    saveToLocalCache(CACHE_KEYS.INVENTORY, newInventory);
    
    // 2. Save to Firebase directly
    const invRef = doc(db, `users/${uid}/data/inventory`);
    await setDoc(invRef, { parts: newInventory, lastUpdated: new Date().toISOString() }, { merge: true });
    
    // 3. Increment cache version (triggers other devices to refresh)
    await incrementCacheVersion('inventory', false);
    
    console.log('? Inventory updated: cache, Firebase, and version incremented');
  }, [saveToLocalCache, incrementCacheVersion, getUid]);

  /**
   * Update worker's cache when manager assigns a job
   * Increments the specific job version in worker's cache
   */
  const updateWorkerCacheVersion = useCallback(async (workerId, jobId) => {
    try {
      const workerCacheRef = doc(db, `users/${workerId}/data/cache`);
      await updateDoc(workerCacheRef, { [jobId]: FieldValue.increment(1) });
      
      console.log(`?? Incremented job ${jobId} version in worker ${workerId}'s cache`);
    } catch (error) {
      console.error('Error updating worker cache version:', error);
    }
  }, []);

  /**
   * Delete field from worker's cache
   * Used when a job is moved from pending to finished
   */
  const deleteWorkerCacheField = useCallback(async (workerId, fieldOrDocId) => {
    try {
      const workerCacheRef = doc(db, `users/${workerId}/data/cache`);
      await updateDoc(workerCacheRef, { [fieldOrDocId]: FieldValue.delete() });
      
      console.log(`??? Deleted ${fieldOrDocId} from worker ${workerId}'s cache`);
    } catch (error) {
      console.error('Error deleting from worker cache:', error);
    }
  }, []);

  /**
   * Add a job to cache (prevents duplicates)
   * Manager adds job ? Company cache, increment job version
   * Worker updates job ? Both worker cache + company cache, increment job version 
   * User adds job ? User cache, increment job version
   */
  const addJob = useCallback(async (job, isPending = true, workerId = null) => {
    const role = getUserRole();
    const uid = getUid();
    
    if (!job.id) {
      console.error('Cannot add job without ID');
      return;
    }
    
    // Helper to add job without duplicates
    const addJobToArray = (jobs, newJob) => {
      const filtered = jobs.filter(j => j.id !== newJob.id);
      return [...filtered, newJob];
    };
    
    console.log(`?? addJob called: id=${job.id}, isPending=${isPending}, role=${role}`);
    
    if (role === 'manager') {
      // Manager adds job to company cache
      if (isPending) {
        const currentJobs = addJobToArray(companyPendingJobs, job);
        saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, currentJobs);
        // Increment individual job version in company cache
        await incrementDocumentVersion(job.id, true);
        
        // If job is assigned to a worker, also increment in worker's cache
        if (workerId) {
          await updateWorkerCacheVersion(workerId, job.id);
        }
      } else {
        const currentJobs = addJobToArray(companyFinishedJobs, job);
        saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, currentJobs);
        await incrementDocumentVersion(job.id, true);
      }
    } else if (role === 'worker') {
      // Worker updates job - update in both worker cache AND company cache
      if (isPending) {
        const currentJobs = addJobToArray(pendingJobs, job);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, currentJobs);
        // Increment job version in both worker and company caches
        await incrementDocumentVersion(job.id, false); // Worker cache
        await incrementDocumentVersion(job.id, true);  // Company cache
      } else {
        const currentJobs = addJobToArray(finishedJobs, job);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, currentJobs);
        await incrementDocumentVersion(job.id, false);
        await incrementDocumentVersion(job.id, true);
      }
    } else {
      // User adds job to user cache
      if (isPending) {
        const currentJobs = addJobToArray(pendingJobs, job);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, currentJobs);
        await incrementDocumentVersion(job.id, false);
      } else {
        const currentJobs = addJobToArray(finishedJobs, job);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, currentJobs);
        await incrementDocumentVersion(job.id, false);
      }
    }
    
    console.log(`? addJob completed for ${job.id}`);
  }, [getUserRole, getUid, pendingJobs, finishedJobs, companyPendingJobs, companyFinishedJobs, saveToLocalCache, incrementDocumentVersion, updateWorkerCacheVersion]);

  /**
   * Update a job in cache
   */
  const updateJob = useCallback(async (jobId, updates, isPending = true) => {
    const role = getUserRole();
    
    const updateJobInArray = (jobs) => 
      jobs.map(j => j.id === jobId ? { ...j, ...updates } : j);
    
    if (role === 'manager') {
      if (isPending) {
        const updatedJobs = updateJobInArray(companyPendingJobs);
        saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, updatedJobs);
        await incrementDocumentVersion(jobId, true);
      } else {
        const updatedJobs = updateJobInArray(companyFinishedJobs);
        saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, updatedJobs);
        await incrementDocumentVersion(jobId, true);
      }
    } else if (role === 'worker') {
      if (isPending) {
        const updatedJobs = updateJobInArray(pendingJobs);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, updatedJobs);
        // Worker updates both caches
        await incrementDocumentVersion(jobId, false);
        await incrementDocumentVersion(jobId, true);
      } else {
        const updatedJobs = updateJobInArray(finishedJobs);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, updatedJobs);
        await incrementDocumentVersion(jobId, false);
      }
    } else {
      if (isPending) {
        const updatedJobs = updateJobInArray(pendingJobs);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, updatedJobs);
        await incrementDocumentVersion(jobId, false);
      } else {
        const updatedJobs = updateJobInArray(finishedJobs);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, updatedJobs);
        await incrementDocumentVersion(jobId, false);
      }
    }
  }, [getUserRole, pendingJobs, finishedJobs, companyPendingJobs, companyFinishedJobs, saveToLocalCache, incrementDocumentVersion]);

  /**
   * Remove a job from cache
   */
  const removeJob = useCallback(async (jobId, isPending = true) => {
    const role = getUserRole();
    
    const filterJobs = (jobs) => jobs.filter(j => j.id !== jobId);
    
    if (role === 'manager') {
      if (isPending) {
        const filteredJobs = filterJobs(companyPendingJobs);
        saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, filteredJobs);
        await deleteCacheField(jobId, true);
      } else {
        const filteredJobs = filterJobs(companyFinishedJobs);
        saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, filteredJobs);
        await deleteCacheField(jobId, true);
      }
    } else if (role === 'worker') {
      if (isPending) {
        const filteredJobs = filterJobs(pendingJobs);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, filteredJobs);
        await deleteCacheField(jobId, false);
        await deleteCacheField(jobId, true);
      } else {
        const filteredJobs = filterJobs(finishedJobs);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, filteredJobs);
        await deleteCacheField(jobId, false);
      }
    } else {
      if (isPending) {
        const filteredJobs = filterJobs(pendingJobs);
        saveToLocalCache(CACHE_KEYS.PENDING_JOBS, filteredJobs);
        await deleteCacheField(jobId, false);
      } else {
        const filteredJobs = filterJobs(finishedJobs);
        saveToLocalCache(CACHE_KEYS.FINISHED_JOBS, filteredJobs);
        await deleteCacheField(jobId, false);
      }
    }
  }, [getUserRole, pendingJobs, finishedJobs, companyPendingJobs, companyFinishedJobs, saveToLocalCache, deleteCacheField]);

  /**
   * Move job from pending to finished (MANAGER ONLY)
   * When a manager accepts a job with status 'waiting', it moves to finished
   * This function:
   * 1. Removes the pending job from company pending jobs cache
   * 2. Adds the finished job to company finished jobs cache
   * 3. Deletes the p_jobId from company cache doc
   * 4. Deletes the p_jobId from worker's cache doc
   * 5. Adds the f_jobId to company cache doc
   * 6. Adds the f_jobId to worker's cache doc
   * 
   * @param {string} pendingJobId - Original pending job ID (p_XXXXX)
   * @param {object} finishedJobData - The finished job data (should already have f_XXXXX id)
   * @param {string} workerId - The worker's uid for cache update
   */
  const moveJobToFinished = useCallback(async (pendingJobId, finishedJobData, workerId = null) => {
    const role = getUserRole();
    
    // Only managers can move jobs to finished
    if (role !== 'manager') {
      console.error('Only managers can move jobs to finished');
      return;
    }
    
    const job = companyPendingJobs.find(j => j.id === pendingJobId);
    if (!job && !finishedJobData) {
      console.error('Job not found in pending jobs');
      return;
    }
    
    const finishedJob = finishedJobData || { ...job, status: 'finished', finishedAt: new Date().toISOString() };
    const finishedJobId = finishedJob.id || pendingJobId;
    const worker = workerId || job?.completedBy;
    
    console.log(`?? moveJobToFinished: ${pendingJobId} -> ${finishedJobId}`);
    
    // 1. Remove from company pending jobs cache
    const newPending = companyPendingJobs.filter(j => j.id !== pendingJobId);
    saveToLocalCache(CACHE_KEYS.COMPANY_PENDING_JOBS, newPending);
    // 4. If there's a worker, add the f_jobId to worker's cache doc
    if (worker) {
      await updateWorkerCacheVersion(worker, finishedJobId);
    }
    // 5. Delete the p_jobId from company cache doc
    await deleteCacheField(pendingJobId, true);
    
    // 2. Add to company finished jobs cache
    const newFinished = [...companyFinishedJobs, finishedJob];
    saveToLocalCache(CACHE_KEYS.COMPANY_FINISHED_JOBS, newFinished);
    // 3. Add the f_jobId to company cache doc
    await incrementDocumentVersion(finishedJobId, true);
    
    // 6. If there's a worker, delete the p_jobId from worker's cache doc
    if (worker) {
      await deleteWorkerCacheField(worker, pendingJobId);
    }
    
    
    console.log(`? moveJobToFinished completed: ${pendingJobId} -> ${finishedJobId}`);
  }, [getUserRole, companyPendingJobs, companyFinishedJobs, saveToLocalCache, deleteCacheField, deleteWorkerCacheField, incrementDocumentVersion, updateWorkerCacheVersion]);

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
   * @param {string} workerId - Worker ID 
   * @param {object} workerData - { email, name, phoneNumber, uid }
   */
  const addWorker = useCallback(async (workerId, workerData) => {
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
    
    console.log(`?? Adding worker ${workerId} to cache...`);
    
    try {
      // 1. Update local cache
      const updatedWorkers = {
        ...workers,
        [workerId]: {
          email: workerData.email,
          name: workerData.name,
          phoneNumber: workerData.phoneNumber,
          Uid: workerData.Uid,
          Wid: workerId || workerData.Wid,
          role: 'worker',
          companyId: companyId
        }
      };
      saveToLocalCache(CACHE_KEYS.WORKERS, updatedWorkers);
      
      // 2. Increment cache version (triggers other devices to refresh)
      await incrementCacheVersion('workers', true);
      
      console.log(`? Worker ${workerId} added to cache successfully`);
      
    } catch (error) {
      console.error('Error adding worker to cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, incrementCacheVersion]);

  /**
   * Edit worker details (called AFTER cloud function updates Firestore)
   * Can update: name, phoneNumber
   * CANNOT update: email (immutable)
   * 
   * @param {string} workerId - Worker ID to edit in cache  
   * @param {object} updates - { name?, phoneNumber? }
   */
  const editWorker = useCallback(async (workerId, updates) => {
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
    
    console.log(`?? Editing worker ${workerId} in cache...`);
    
    try {
      // 1. Update local cache
      const currentWorker = workers[workerId];
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
        [workerId]: updatedWorkerData
      };
      saveToLocalCache(CACHE_KEYS.WORKERS, updatedWorkers);
      
      // 2. Increment cache version
      await incrementCacheVersion('workers', true);
      
      console.log(`? Worker ${workerId} updated in cache successfully`);
      
    } catch (error) {
      console.error('Error editing worker in cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, incrementCacheVersion]);

  /**
   * Delete worker from cache (called AFTER cloud function deletes Auth user and Firestore docs)
   * Removes:
   * 1. Worker from local cache
   * 2. Increment cache version
   * 
   * @param {string} workerId - Worker ID to delete from cache
   */
  const deleteWorker = useCallback(async (workerId) => {
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
    
    console.log(`??? Deleting worker ${workerId} from cache...`);
    
    try {
      // 1. Remove from local cache
      const { [workerId]: deletedWorker, ...remainingWorkers } = workers;
      saveToLocalCache(CACHE_KEYS.WORKERS, remainingWorkers);
      
      // 2. Increment cache version
      await incrementCacheVersion('workers', true);
      
      console.log(`? Worker ${workerId} deleted from cache successfully`);
      
    } catch (error) {
      console.error('Error deleting worker from cache:', error);
      throw error;
    }
  }, [workers, getUserRole, getCompanyId, saveToLocalCache, incrementCacheVersion]);

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
    // Increment specific document version in company cache
    await incrementDocumentVersion(document.id, true);
  }, [documents, saveToLocalCache, incrementDocumentVersion]);

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
      // Call addClientV1 CF — uses phone-app cid counter pattern on the server side
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

      // Pre-increment local cache version to match what the CF just wrote to Firestore.
      // This prevents the snapshot listener from triggering an unnecessary refetch
      // (local version will already match remote when the snapshot arrives).
      const role = getUserRole();
      const isCompanyCache = role === 'manager';
      const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_CACHE_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
      const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
      localVersions['clients'] = (localVersions['clients'] || 0) + 1;
      saveToLocalCache(localVersionsKey, localVersions);

      console.log(`✅ Client created with ID: ${newClient.id}`);
      return newClient;
    } catch (error) {
      console.error('❌ Error creating client:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      throw error;
    }
  }, [getCompanyId, getUserRole, clients, saveToLocalCache]);

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
      // CF deletes the Firestore doc and bumps companies/{companyId}/business_data/cache.clients
      const deleteClientFn = httpsCallable(functions, 'deleteClientV1');
      await deleteClientFn({ companyId, clientId });

      // Update local client list immediately (optimistic)
      const updatedClients = clients.filter(c => c.id !== clientId);
      saveToLocalCache(CACHE_KEYS.CLIENTS, updatedClients);
      setClients(updatedClients);

      // Pre-increment local cache version to match the Firestore version CF just wrote.
      // This prevents the snapshot listener from triggering an unnecessary refetch
      // (local version will already match remote when the snapshot arrives).
      const role = getUserRole();
      const isCompanyCache = role === 'manager';
      const localVersionsKey = isCompanyCache ? CACHE_KEYS.COMPANY_CACHE_VERSIONS : CACHE_KEYS.CACHE_VERSIONS;
      const localVersions = mmkvHelpers.getObject(localVersionsKey) || {};
      localVersions['clients'] = (localVersions['clients'] || 0) + 1;
      saveToLocalCache(localVersionsKey, localVersions);

      console.log(`✅ Client ${clientId} deleted via CF`);
    } catch (error) {
      console.error('Error deleting client:', error);
      throw error;
    }
  }, [getCompanyId, getUserRole, clients, saveToLocalCache]);

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
    
    // Clear MMKV storage
    mmkvHelpers.clearAll();
    
    // P2-4: Reset scope prefix
    _mmkvScopePrefix = '';
    
    // Reset state
    setProfile(null);
    setInventory([]);
    setPendingJobs([]);
    setFinishedJobs([]);
    setWorkers({});
    setCompanyPendingJobs([]);
    setCompanyFinishedJobs([]);
    setDocuments([]);
    setClients([]);
    setSubscription(null);
    setCacheVersions({});
    setCompanyCacheVersions({});
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
    
    // Get cached data based on type and role
    let cachedData = [];
    if (dataType === 'finishedJobs') {
      cachedData = role === 'manager' ? companyFinishedJobs : finishedJobs;
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
          const finishedJobsRef = collection(db, 'companies', companyId, 'finishedJobs');
          if (role == 'worker') {
            q = query(finishedJobsRef,
              where('finishedAt', '>=', monthStart.toISOString()),
              where('finishedAt', '<', cacheStartDate.toISOString()),
              where('completedBy', '==', uid)
            );
          } else {
            q = query(finishedJobsRef,
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
        
        console.log(`?? Fetched ${firebaseData.length} missing records from Firebase for month ${monthDate.getMonth() + 1}`);
        
        return [...cachedMonthData, ...firebaseData];
      } catch (error) {
        console.error('Error fetching partial month data:', error);
        return cachedMonthData;
      }
    }
    
    // Case 3: Month is completely outside cache range - try Firestore first, then Storage
    console.log(`?? Month ${monthDate.getMonth() + 1}/${monthDate.getFullYear()} is outside cache range, querying Firestore...`);
    
    try {
      let q;
      
      if (dataType === 'finishedJobs') {
        const finishedJobsRef = collection(db, 'companies', companyId, 'finishedJobs');
        if (role == 'worker') {
          q = query(finishedJobsRef,
            where('finishedAt', '>=', monthStart.toISOString()),
            where('finishedAt', '<=', monthEnd.toISOString()),
            where('completedBy', '==', uid)
          );
        } else {
          q = query(finishedJobsRef,
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
            const filtered = archivedData.filter(item => item.completedBy === uid);
            console.log(`?? Filtered archived data: ${filtered.length}/${archivedData.length} docs for user ${uid}`);
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
  }, [getUserRole, getUid, getCompanyId, finishedJobs, companyFinishedJobs, documents, fetchFromArchive]);

  /**
   * Get data for a date range with smart caching
   * Used for "Last 7 days", "Last month" filters
   */
  const getDataForDateRange = useCallback(async (startDate, endDate, dataType) => {
    const role = getUserRole();
    const uid = getUid();
    const companyId = getCompanyId();
    
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const cacheStartMs = getCacheStartDate().getTime();
    
    // Get cached data based on type and role
    let cachedData = [];
    if (dataType === 'finishedJobs') {
      cachedData = role === 'manager' ? companyFinishedJobs : finishedJobs;
    } else if (dataType === 'documents') {
      cachedData = documents;
    } else if (dataType === 'pendingJobs') {
      cachedData = role === 'manager' ? companyPendingJobs : pendingJobs;
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
        const finishedJobsRef = collection(db, 'companies', companyId, 'finishedJobs');
        if (role == 'worker') {
          q = query(finishedJobsRef,
            where('finishedAt', '>=', startDate.toISOString()),
            where('finishedAt', '<', getCacheStartDate().toISOString()),
            where('completedBy', '==', uid)
          );
        } else {
          q = query(finishedJobsRef,
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
        const pendingJobsRef = collection(db, 'companies', companyId, 'PendingJobs');
        if (role !== 'manager') {
          q = query(pendingJobsRef,
            where('createdAt', '>=', startDate.toISOString()),
            where('createdAt', '<', getCacheStartDate().toISOString()),
            where('completedBy', '==', uid)
          );
        } else {
          q = query(pendingJobsRef,
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
                const userField = dataType === 'finishedJobs' ? 'completedBy' : 'createdByUid';
                const userFiltered = filtered.filter(item => item[userField] === uid);
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
  }, [getUserRole, getUid, getCompanyId, pendingJobs, finishedJobs, companyPendingJobs, companyFinishedJobs, documents, fetchFromArchive]);

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
    pendingJobs,
    finishedJobs,
    workers,
    companyPendingJobs,
    companyFinishedJobs,
    documents,
    clients,
    subscription,
    
    // Getters (primary)
    getUid,
    getUserRole,
    getCompanyId,
    // Backward-compatible aliases
    getUsername,
    getCompanyName,
    
    // Initialization
    initializeCache,
    clearCache,
    
    // Profile & Inventory
    updateProfile,
    updateInventory,
    
    // Jobs
    addJob,
    updateJob,
    removeJob,
    moveJobToFinished,
    
    // Manager specific
    updateWorkers,
    updateWorkersList: updateWorkers, // Backward compatibility for existing screens
    addWorker,
    editWorker,
    deleteWorker,
    updateWorkerCacheVersion,
    deleteWorkerCacheField,
    
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
    incrementCacheVersion,
    incrementDocumentVersion,
    deleteCacheField,
    
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
