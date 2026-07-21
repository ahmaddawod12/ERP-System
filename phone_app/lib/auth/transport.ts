import {
  getSupabaseAccessToken,
  installSupabaseAuthLifecycle,
  restoreSupabaseSession,
  signInSupabase,
  signOutSupabase,
  subscribeSupabaseAuth,
} from './supabase-client';

export type SupabaseAuthUser = {
  uid: string;
  email: string | null;
  getIdToken: (_forceRefresh?: boolean) => Promise<string>;
};

const authListeners = new Set<(user: SupabaseAuthUser | null) => void>();
let authCurrentUser: SupabaseAuthUser | null = null;
let authBridgePromise: Promise<void> | null = null;
let authBridgeCleanup: (() => void) | null = null;

function toSupabaseAuthUser(uid: string, email: string | null): SupabaseAuthUser {
  return {
    uid,
    email,
    getIdToken: async (forceRefresh = false) => {
      const token = await getSupabaseAuthTransportToken(forceRefresh);
      if (!token) {
        throw new Error('User must be authenticated');
      }
      return token;
    },
  };
}

function emitAuthStateChange(): void {
  for (const listener of authListeners) {
    listener(authCurrentUser);
  }
}

function setAuthCurrentUser(uid: string, email: string | null): void {
  authCurrentUser = toSupabaseAuthUser(uid, email);
  emitAuthStateChange();
}

function clearAuthCurrentUser(): void {
  authCurrentUser = null;
  emitAuthStateChange();
}

function ensureAuthBridge(): Promise<void> {
  if (authBridgePromise) return authBridgePromise;

  const promise = (async () => {
    let removeLifecycle: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    try {
      removeLifecycle = installSupabaseAuthLifecycle();
      unsubscribe = subscribeSupabaseAuth((_session, user) => {
        if (user) {
          setAuthCurrentUser(user.id, user.email ?? null);
        } else {
          clearAuthCurrentUser();
        }
      });
      authBridgeCleanup = () => {
        unsubscribe?.();
        removeLifecycle?.();
      };

      const restored = await restoreSupabaseSession();
      if (restored?.user) {
        setAuthCurrentUser(restored.user.id, restored.user.email ?? null);
      } else {
        clearAuthCurrentUser();
      }
    } catch (error) {
      if (authBridgeCleanup) {
        authBridgeCleanup();
      } else {
        unsubscribe?.();
        removeLifecycle?.();
      }
      authBridgeCleanup = null;
      throw error;
    }
  })();
  authBridgePromise = promise;
  void promise.catch(() => {
    if (authBridgePromise === promise) authBridgePromise = null;
  });
  return promise;
}

export async function signInSupabaseAuthTransport(email: string, password: string): Promise<void> {
  await ensureAuthBridge();
  const session = await signInSupabase(email, password);
  setAuthCurrentUser(session.user.id, session.user.email ?? null);
}

export async function getSupabaseAuthTransportToken(forceRefresh = true): Promise<string | null> {
  await ensureAuthBridge();
  return getSupabaseAccessToken(forceRefresh);
}

export async function clearSupabaseAuthTransportSession(): Promise<void> {
  await signOutSupabase();
  clearAuthCurrentUser();
}

export const auth = {
  get currentUser(): SupabaseAuthUser | null {
    return authCurrentUser;
  },
};

export async function signInWithEmailAndPassword(
  authInstance: unknown,
  email: string,
  password: string,
) {
  void authInstance;
  await signInSupabaseAuthTransport(email, password);
  return { user: auth.currentUser };
}

export async function signOut(authInstance: unknown): Promise<void> {
  void authInstance;
  await clearSupabaseAuthTransportSession();
}

export function onAuthStateChanged(
  authInstance: unknown,
  listener: (user: SupabaseAuthUser | null) => void,
): () => void {
  void authInstance;
  let active = true;
  let notified = false;
  const trackedListener = (user: SupabaseAuthUser | null) => {
    if (!active) return;
    notified = true;
    listener(user);
  };
  authListeners.add(trackedListener);
  void ensureAuthBridge()
    .then(() => {
      if (!notified) trackedListener(auth.currentUser);
    })
    .catch(() => {
      if (!notified) trackedListener(null);
    });
  return () => {
    active = false;
    authListeners.delete(trackedListener);
  };
}
