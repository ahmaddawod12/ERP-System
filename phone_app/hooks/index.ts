/**
 * Custom React hooks for Smart-Job App
 * Reusable hooks to reduce boilerplate and improve performance
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, onAuthStateChanged } from '../firebase';
import type { SupabaseAuthUser } from '../firebase';

/**
 * Hook for managing authentication state
 * @returns {Object} { user, loading, error, uid, userRole }
 */
export interface UseAuthResult {
  user: SupabaseAuthUser | null;
  loading: boolean;
  error: Error | null;
  uid: string | null;
  username: string | null;
  userRole: null;
}

export const useAuth = (): UseAuthResult => {
  const [user, setUser] = useState<SupabaseAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const uid = useMemo(() => {
    return user ? user.uid : null;
  }, [user]);

  // Backward-compatible alias
  return { user, loading, error, uid, username: uid, userRole: null };
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
