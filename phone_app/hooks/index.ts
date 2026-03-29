/**
 * Custom React hooks for Smart-Job App
 * Reusable hooks to reduce boilerplate and improve performance
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, db, doc, getDoc, onAuthStateChanged, onSnapshot } from '../firebase';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

type AppRole = 'manager' | 'worker' | 'user' | 'basic' | 'dev';

const APP_ROLES: AppRole[] = ['manager', 'worker', 'user', 'basic', 'dev'];

function normalizeRoleValue(role: unknown): AppRole {
  const raw = String(role || '').trim().toLowerCase();
  return APP_ROLES.includes(raw as AppRole) ? (raw as AppRole) : 'user';
}

/**
 * Hook for managing authentication state
 * @returns {Object} { user, loading, error, uid, userRole }
 */
export interface UseAuthResult {
  user: FirebaseAuthTypes.User | null;
  loading: boolean;
  error: Error | null;
  uid: string | null;
  username: string | null;
  userRole: AppRole | null;
}

export const useAuth = (): UseAuthResult => {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userRole, setUserRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      
      if (authUser) {
        try {
          const uid = authUser.uid;
          // React Native Firebase modular API
          const userDocRef = doc(db, 'users', uid, 'data', 'profile');
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            setUserRole(normalizeRoleValue(userDoc.data()?.role));
          } else {
            setUserRole('user');
          }
        } catch (err) {
          setError(err as Error);
          console.error('Error fetching user role:', err);
        }
      } else {
        setUserRole(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const uid = useMemo(() => {
    return user ? user.uid : null;
  }, [user]);

  // Backward-compatible alias
  return { user, loading, error, uid, username: uid, userRole };
};

/**
 * Hook for real-time Firestore document listening
 * @param {string} path - Firestore document path
 * @param {Array} pathSegments - Array of path segments [collection, doc, subcollection, doc]
 * @returns {Object} { data, loading, error, refresh }
 */
export interface UseFirestoreDocResult<T = Record<string, any>> {
  data: (T & { id: string }) | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export const useFirestoreDoc = <T = Record<string, any>>(...pathSegments: string[]): UseFirestoreDocResult<T> => {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!pathSegments || pathSegments.length === 0) {
      setLoading(false);
      return;
    }

    try {
      // Build document reference using React Native Firebase modular API
      // pathSegments: [collection, doc, subcollection, doc, ...]
      const docRef = doc(db, ...pathSegments);
      
      const unsubscribe = onSnapshot(
        docRef,
        (snapshot: any) => {
          if (snapshot.exists()) {
            setData({ id: snapshot.id, ...snapshot.data() } as T & { id: string });
          } else {
            setData(null);
          }
          setLoading(false);
        },
        (err: Error) => {
          setError(err);
          setLoading(false);
          console.error('Firestore listener error:', err);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      console.error('Error setting up Firestore listener:', err);
    }
  }, [JSON.stringify(pathSegments)]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Build document reference using React Native Firebase modular API
      const docRef = doc(db, ...pathSegments);
      const snapshot = await getDoc(docRef) as any;
      
      if (snapshot.exists()) {
        setData({ id: snapshot.id, ...snapshot.data() } as T & { id: string });
      } else {
        setData(null);
      }
    } catch (err) {
      setError(err as Error);
      console.error('Error refreshing document:', err);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(pathSegments)]);

  return { data, loading, error, refresh };
};

/**
 * Hook for managing user profile with real-time updates
 * @param {string} uid - User UID to fetch profile for
 * @returns {Object} { profile, loading, error, refresh }
 */
export const useUserProfile = (uid: string) => {
  return useFirestoreDoc('users', uid, 'data', 'profile');
};

/**
 * Hook for managing company data
 * @param {string} companyId - Company ID
 * @returns {Object} { companyData, loading, error }
 */
export const useCompanyData = (companyId: string) => {
  const { data: workersData, loading: workersLoading } = useFirestoreDoc(
    'companies', 
    companyId, 
    'workers', 
    'list'
  );

  return {
    workers: workersData,
    loading: workersLoading,
  };
};

/**
 * Hook for debounced search
 * @param {string} value - Search value
 * @param {number} delay - Debounce delay in ms
 * @returns {string} Debounced value
 */
export const useDebounce = <T>(value: T, delay = 500): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Hook for managing form state
 * @param {Object} initialValues - Initial form values
 * @returns {Object} { values, handleChange, reset, setValues }
 */
export const useForm = <T extends Record<string, any>>(initialValues: T = {} as T) => {
  const [values, setValues] = useState<T>(initialValues);

  const handleChange = useCallback((name: keyof T & string, value: T[keyof T]) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialValues);
  }, [initialValues]);

  return { values, handleChange, reset, setValues };
};

export { useDocumentTask } from './useDocumentTask';
export { useAppStateListener } from './useAppStateListener';
export { useNetworkStatus } from './useNetworkStatus';
