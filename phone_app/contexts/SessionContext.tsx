import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getFirebaseIdToken,
  restoreFirebaseUser,
  signInFirebase,
  signOutFirebase,
  subscribeFirebaseAuth,
  type FirebaseAuthUser,
} from '../lib/auth/firebase-auth';

type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  readonly status: SessionStatus;
  readonly user: FirebaseAuthUser | null;
  readonly error: Error | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly getAccessToken: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeFirebaseAuth((nextUser) => {
      if (!active) {
        return;
      }
      setUser(nextUser);
      setStatus(nextUser ? 'authenticated' : 'unauthenticated');
      setError(null);
    });

    void restoreFirebaseUser()
      .then((restored) => {
        if (!active) {
          return;
        }
        setUser(restored);
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
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const established = await signInFirebase(email, password);
    setUser(established);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await signOutFirebase();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    user,
    error,
    signIn,
    signOut,
    getAccessToken: () => getFirebaseIdToken(true),
  }), [error, signIn, signOut, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
