// firebase.js - React Native Firebase Implementation (Modular API v22+)
// This file exports Firebase services using @react-native-firebase modular API
// Note: Native configuration is in GoogleService-Info.plist (iOS) and google-services.json (Android)

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
import { getEdgeFunctionPath } from '@smart-job/contracts';
import {
  getSupabaseAccessToken,
  installSupabaseAuthLifecycle,
  restoreSupabaseSession,
  signInSupabase,
  signOutSupabase,
  subscribeSupabaseAuth,
} from './lib/auth/supabase-client';

// Get the default app instance (modular API)
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

// Storage - chainable API (use storage().ref())
export { storage };

// Placeholder instances kept for backward-compatible call sites.
export const functions = { region: 'us-central1' } as const;
export const middleEastFunctions = { region: 'me-west1' } as const;

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getSupabaseEdgeBaseUrl(): string {
  const explicitBase = process.env.EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL;
  if (explicitBase) {
    return trimTrailingSlash(explicitBase);
  }

  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL for edge function calls');
  }
  return `${trimTrailingSlash(supabaseUrl)}/functions/v1`;
}

function getMutationGatewayTarget(operation: string): { edgePath: string } {
  const directPayloadOps = new Set([
    'createInviteV1',
    'joinCompanyV1',
    'requestUpgradeV1',
    'listUpgradeRequestsV1',
    'moderateUpgradeRequestV1',
  ]);

  // Direct-to-function operations use the shared edge-function name map.
  if (directPayloadOps.has(operation)) {
    return { edgePath: getEdgeFunctionPath(operation) };
  }

  // Tax invoice approval is routed to the regional mutation gateway.
  if (operation === 'getInvoiceApproval') {
    return { edgePath: 'mutation-gateway-me-west1' };
  }

  return { edgePath: 'mutation-gateway' };
}

async function callProtectedGatewayOperation<T = unknown>(operation: string, payload?: unknown): Promise<T> {
  const token = await getSupabaseAuthTransportToken(true);
  if (!token) {
    throw new Error('User must be authenticated');
  }

  const target = getMutationGatewayTarget(operation);
  const directPayloadOps = new Set([
    'createInviteV1',
    'joinCompanyV1',
    'requestUpgradeV1',
    'listUpgradeRequestsV1',
    'moderateUpgradeRequestV1',
  ]);
  const requestBody = directPayloadOps.has(operation)
    ? (payload || {})
    : {
      operation,
      payload: payload || {},
    };

  const response = await fetch(`${getSupabaseEdgeBaseUrl()}/${target.edgePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: T;
    error?: { message?: string };
  } | null;

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error?.message || `${operation} failed`);
  }

  return body.data as T;
}

// Messaging instance (modular API)
export const messaging = getMessaging(app);

// Re-export Auth modular functions (wrapped to preserve API surface)
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

// Note: Storage uses chainable API - use storage().ref().put() for uploads

// Re-export callable-like wrapper that routes to the HTTP mutation gateway.
export function httpsCallable(_functionsInstance: unknown, operation: string) {
  return async (payload?: unknown) => ({
    data: await callProtectedGatewayOperation(operation, payload),
  });
}

// Re-export Messaging modular functions
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
