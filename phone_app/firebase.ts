import { getApp } from '@react-native-firebase/app';
import storage from '@react-native-firebase/storage';
import {
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  hasPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
  getAPNSToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import {
  getSupabaseAccessToken,
  installSupabaseAuthLifecycle,
  restoreSupabaseSession,
  signInSupabase,
  signOutSupabase,
  subscribeSupabaseAuth,
} from './lib/auth/supabase-client';

export const app = getApp();

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

function emitAuthStateChange() {
  for (const listener of authListeners) {
    listener(authCurrentUser);
  }
}

function setAuthCurrentUser(uid: string, email: string | null) {
  authCurrentUser = toSupabaseAuthUser(uid, email);
  emitAuthStateChange();
}

function clearAuthCurrentUser() {
  authCurrentUser = null;
  emitAuthStateChange();
}

function ensureAuthBridge(): Promise<void> {
  authBridgePromise ??= (async () => {
    const removeLifecycle = installSupabaseAuthLifecycle();
    const unsubscribe = subscribeSupabaseAuth((_session, user) => {
      if (user) {
        setAuthCurrentUser(user.id, user.email ?? null);
      } else {
        clearAuthCurrentUser();
      }
    });
    authBridgeCleanup = () => {
      unsubscribe();
      removeLifecycle();
    };

    const restored = await restoreSupabaseSession();
    if (restored?.user) {
      setAuthCurrentUser(restored.user.id, restored.user.email ?? null);
    } else {
      clearAuthCurrentUser();
    }
  })();
  return authBridgePromise;
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

export { storage };

export const messaging = getMessaging(app);

export async function signInWithEmailAndPassword(authInstance: any, email: string, password: string) {
  void authInstance;
  await signInSupabaseAuthTransport(email, password);
  return { user: auth.currentUser };
}

export async function signOut(authInstance: any) {
  void authInstance;
  await clearSupabaseAuthTransportSession();
}

export function onAuthStateChanged(authInstance: any, listener: (user: any) => void) {
  void authInstance;
  let active = true;
  void ensureAuthBridge().then(() => {
    if (!active) {
      return;
    }
    authListeners.add(listener);
    listener(auth.currentUser);
  });
  return () => {
    active = false;
    authListeners.delete(listener);
  };
}

export {
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  hasPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
  getAPNSToken,
  AuthorizationStatus,
};
