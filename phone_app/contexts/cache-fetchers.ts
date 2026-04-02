/**
 * cache-fetchers.ts
 *
 * Pure Firebase data-fetching functions extracted from CacheContext.
 * These functions are stateless: they accept all required parameters and return
 * raw data without closing over any React component state.
 *
 * Extracted to keep CacheContext focused on orchestration and state management.
 */

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from '../firebase';
import {
  mmkvHelpers,
  CACHE_KEYS,
  getCacheStartDate,
} from './mmkv-storage';
import {
  buildJobMembershipQueryValues,
  roleUsesScopedJobAccess,
} from './job-membership';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildJobMembershipConstraints(wid: string | number | null): any[] {
  const values = buildJobMembershipQueryValues(wid);
  if (values.length === 0) return [];
  return [
    values.length === 1
      ? where('wid', '==', values[0])
      : where('wid', 'in', values),
  ];
}

// ─── Exported fetchers ───────────────────────────────────────────────────────

/**
 * Fetch a single Firestore-backed field for a user/company.
 * Covers: profile, inventory, workers, business_info, clients, subscription.
 */
export async function fetchDataFromFirebase(
  field: string,
  uid: string,
  companyId: string,
  role: string,
): Promise<any> {
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
          return inventoryDoc.data()!.parts || [];
        }
        return [];
      }

      case 'workers': {
        if (role === 'manager') {
          const workersRef = collection(db, 'companies', companyId, 'workers');
          const snapshot = await getDocs(workersRef);
          const workersData: Record<string, any> = {};
          snapshot.forEach((docSnap: any) => {
            const workerDoc = docSnap.data() || {};
            const wid = docSnap.id;
            workersData[wid] = { ...workerDoc, wid };
          });
          return workersData;
        }
        return {};
      }

      case 'business_info':
        // No longer cached — Cloud Functions fetch it directly for security.
        return null;

      case 'clients': {
        if (!companyId) return [];
        const clientsRef = collection(db, 'companies', companyId, 'clients');
        const snapshot = await getDocs(clientsRef);
        const clientsList: any[] = [];
        snapshot.forEach((d: any) => {
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
}

/**
 * Fetch a single job or document by ID.
 * Tries the `jobs` sub-collection first, then `documents`.
 */
export async function fetchDocumentById(
  docId: string,
  _uid: string,
  companyId: string,
  _role: string,
): Promise<any | null> {
  console.log(`[FIREBASE READ] Fetching document ${docId} from Firebase...`);

  try {
    let docRef = doc(db, 'companies', companyId, 'jobs', docId);
    let docSnap = await getDoc(docRef);
    if (docSnap.exists()) return { id: docId, ...docSnap.data() };

    docRef = doc(db, 'companies', companyId, 'documents', docId);
    docSnap = await getDoc(docRef);
    if (docSnap.exists()) return { id: docId, ...docSnap.data() };

    console.warn(`Document ${docId} not found in jobs or documents collection`);
    return null;
  } catch (error) {
    console.error(`Error fetching document ${docId}:`, error);
    return null;
  }
}

/**
 * Fetch all recent jobs (within 90 days for finished + all pending/waiting)
 * and documents from Firebase. Used for first-time cache population.
 *
 * Reads `wid` directly from MMKV so callers don't need to pass it.
 */
export async function fetchAllRecentJobs(
  _uid: string,
  companyId: string,
  role: string,
): Promise<{ jobsData: any[]; documentsData: any[] }> {
  if (role === 'dev') {
    console.log('Dev role: skipping all jobs/documents fetch (early return)');
    return { jobsData: [], documentsData: [] };
  }

  console.log('[FIREBASE READ] Fetching all recent jobs from Firebase (first-time init)...');
  const ninetyDaysAgo = getCacheStartDate().toISOString();
  const wid = mmkvHelpers.getString(CACHE_KEYS.USER_WID);

  try {
    let jobsData: any[] = [];
    let documentsData: any[] = [];

    if (role === 'manager') {
      const jobsRef = collection(db, 'companies', companyId, 'jobs');
      try {
        const [pendingSnapshot, recentSnapshot] = await Promise.all([
          getDocs(query(jobsRef, where('status', 'in', ['pending', 'waiting']))),
          getDocs(query(jobsRef, where('createdAt', '>=', ninetyDaysAgo))),
        ]);
        const merged = new Map();
        pendingSnapshot.docs.forEach((d: any) => merged.set(d.id, { id: d.id, ...d.data() }));
        recentSnapshot.docs.forEach((d: any) => merged.set(d.id, { id: d.id, ...d.data() }));
        jobsData = Array.from(merged.values());
      } catch {
        const jobsSnapshot = await getDocs(jobsRef);
        const allJobs = jobsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        jobsData = allJobs.filter((j: any) => {
          if (j.status === 'pending' || j.status === 'waiting') return true;
          const dateField = j.updatedAt || j.createdAt;
          if (!dateField) return true;
          return dateField >= ninetyDaysAgo;
        });
      }
      console.log(`Fetched ${jobsData.length} jobs for manager`);

      const documentsRef = collection(db, 'companies', companyId, 'documents');
      const documentsSnapshot = await getDocs(
        query(documentsRef, where('createdAt', '>=', ninetyDaysAgo)),
      );
      documentsData = documentsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      console.log(`Fetched ${documentsData.length} documents for manager`);

    } else if (role === 'worker' || role === 'user') {
      const jobsRef = collection(db, 'companies', companyId, 'jobs');
      const scopedConstraints = buildJobMembershipConstraints(wid);
      if (scopedConstraints.length > 0) {
        try {
          const [pendingSnapshot, recentSnapshot] = await Promise.all([
            getDocs((query as any)(jobsRef, ...scopedConstraints, where('status', 'in', ['pending', 'waiting']))),
            getDocs((query as any)(jobsRef, ...scopedConstraints, where('createdAt', '>=', ninetyDaysAgo))),
          ]);
          const merged = new Map();
          pendingSnapshot.docs.forEach((d: any) => merged.set(d.id, { id: d.id, ...d.data() }));
          recentSnapshot.docs.forEach((d: any) => merged.set(d.id, { id: d.id, ...d.data() }));
          jobsData = Array.from(merged.values());
        } catch {
          const jobsSnapshot = await getDocs(query(jobsRef, ...scopedConstraints));
          const allJobs = jobsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          jobsData = allJobs.filter((j: any) => {
            if (j.status === 'pending' || j.status === 'waiting') return true;
            const dateField = j.updatedAt || j.createdAt;
            if (!dateField) return true;
            return dateField >= ninetyDaysAgo;
          });
        }
      }
      console.log(`Fetched ${jobsData.length} jobs for ${role}`);

      if (role === 'user') {
        const documentsRef = collection(db, 'companies', companyId, 'documents');
        const documentsSnapshot = await getDocs(
          query(documentsRef, where('createdAt', '>=', ninetyDaysAgo)),
        );
        documentsData = documentsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        console.log(`Fetched ${documentsData.length} documents for user`);
      }

    } else if (role === 'basic') {
      const documentsRef = collection(db, 'companies', companyId, 'documents');
      const documentsSnapshot = await getDocs(
        query(documentsRef, where('createdAt', '>=', ninetyDaysAgo)),
      );
      documentsData = documentsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      console.log(`Fetched ${documentsData.length} documents for basic user`);
    }

    return { jobsData, documentsData };
  } catch (error) {
    console.error('Error fetching all recent jobs:', error);
    return { jobsData: [], documentsData: [] };
  }
}
