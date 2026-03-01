/**
 * Custom React hooks for Smart-Job App
 * Reusable hooks to reduce boilerplate and improve performance
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, db, doc, getDoc, onAuthStateChanged, onSnapshot } from '../firebase';

const APP_ROLES = ['manager', 'worker', 'user', 'basic', 'dev'];

function normalizeRoleValue(role) {
  const raw = String(role || '').trim().toLowerCase();
  return APP_ROLES.includes(raw) ? raw : 'user';
}

/**
 * Hook for managing authentication state
 * @returns {Object} { user, loading, error, uid, userRole }
 */
export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState(null);

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
            setUserRole(normalizeRoleValue(userDoc.data().role));
          } else {
            setUserRole('user');
          }
        } catch (err) {
          setError(err);
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
export const useFirestoreDoc = (...pathSegments) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        (snapshot) => {
          if (snapshot.exists()) {
            setData({ id: snapshot.id, ...snapshot.data() });
          } else {
            setData(null);
          }
          setLoading(false);
        },
        (err) => {
          setError(err);
          setLoading(false);
          console.error('Firestore listener error:', err);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err);
      setLoading(false);
      console.error('Error setting up Firestore listener:', err);
    }
  }, [JSON.stringify(pathSegments)]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Build document reference using React Native Firebase modular API
      const docRef = doc(db, ...pathSegments);
      const snapshot = await getDoc(docRef);
      
      if (snapshot.exists()) {
        setData({ id: snapshot.id, ...snapshot.data() });
      } else {
        setData(null);
      }
    } catch (err) {
      setError(err);
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
export const useUserProfile = (uid) => {
  return useFirestoreDoc('users', uid, 'data', 'profile');
};

/**
 * Hook for managing company data
 * @param {string} companyId - Company ID
 * @returns {Object} { companyData, loading, error }
 */
export const useCompanyData = (companyId) => {
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
export const useDebounce = (value, delay = 500) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

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
export const useForm = (initialValues = {}) => {
  const [values, setValues] = useState(initialValues);

  const handleChange = useCallback((name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialValues);
  }, [initialValues]);

  return { values, handleChange, reset, setValues };
};

export { useDocumentTask } from './useDocumentTask';
export { useAppStateListener } from './useAppStateListener';
