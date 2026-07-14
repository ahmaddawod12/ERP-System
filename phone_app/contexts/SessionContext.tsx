import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import {
  getSupabaseAccessToken,
  installSupabaseAuthLifecycle,
  restoreSupabaseSession,
  signInSupabase,
  signOutSupabase,
  subscribeSupabaseAuth,
} from '../lib/auth/supabase-client';

type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  readonly status: SessionStatus;
  readonly session: Session | null;
  readonly user: User | null;
  readonly error: Error | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly getAccessToken: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const removeLifecycle = installSupabaseAuthLifecycle();
    const unsubscribe = subscribeSupabaseAuth((nextSession) => {
      if (!active) {
        return;
      }
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
      setError(null);
    });

    void restoreSupabaseSession()
      .then((restored) => {
        if (!active) {
          return;
        }
        setSession(restored);
        setStatus(restored ? 'authenticated' : 'unauthenticated');
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setError(cause instanceof Error ? cause : new Error('Session restoration failed'));
        setStatus('unauthenticated');
      });

    return () => {
      active = false;
      unsubscribe();
      removeLifecycle();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const established = await signInSupabase(email, password);
    setSession(established);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await signOutSupabase();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    session,
    user: session?.user ?? null,
    error,
    signIn,
    signOut,
    getAccessToken: () => getSupabaseAccessToken(true),
  }), [error, session, signIn, signOut, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

