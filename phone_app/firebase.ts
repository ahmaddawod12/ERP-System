// firebase.js - React Native Firebase Implementation (Modular API v22+)
// This file exports Firebase services using @react-native-firebase modular API
// Note: Native configuration is in GoogleService-Info.plist (iOS) and google-services.json (Android)

import { getApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
} from '@react-native-firebase/app-check';
import appCheck from '@react-native-firebase/app-check';
import * as SecureStore from 'expo-secure-store';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp as FirestoreTimestamp,
  FieldValue as FirestoreFieldValue,
  GeoPoint as FirestoreGeoPoint,
  increment,
} from '@react-native-firebase/firestore';
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
import { storage as mmkvStorage } from './contexts/mmkv-storage';

// Get the default app instance (modular API)
export const app = getApp();

// Initialize App Check — required for Cloud Functions enforcement
// Uses DeviceCheck (iOS) and Play Integrity (Android) attestation providers
const appCheckProvider = appCheck().newReactNativeFirebaseAppCheckProvider();
appCheckProvider.configure({
  apple: {
    provider: __DEV__ ? 'debug' : 'deviceCheck',
  },
  android: {
    provider: __DEV__ ? 'debug' : 'playIntegrity',
  },
});
initializeAppCheck(app, {
  provider: appCheckProvider,
  isTokenAutoRefreshEnabled: true,
});

// Firestore instance (modular API)
export const db = getFirestore(app);

export type SupabaseAuthUser = {
  uid: string;
  email: string | null;
  getIdToken: (_forceRefresh?: boolean) => Promise<string>;
};

const authListeners = new Set<(user: SupabaseAuthUser | null) => void>();
let authCurrentUser: SupabaseAuthUser | null = null;

const SUPABASE_ACCESS_TOKEN_KEY = 'auth_supabase_access_token';
const SUPABASE_REFRESH_TOKEN_KEY = 'auth_supabase_refresh_token';
const SUPABASE_EXPIRES_AT_KEY = 'auth_supabase_expires_at';
const SUPABASE_UID_KEY = 'auth_supabase_uid';
const SUPABASE_EMAIL_KEY = 'auth_supabase_email';

type SupabaseSessionPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  user?: {
    id?: unknown;
    email?: unknown;
  };
  error_description?: unknown;
  msg?: unknown;
};

async function isSecureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function getSecureAuthItem(key: string): Promise<string> {
  if (!(await isSecureStoreAvailable())) {
    return '';
  }
  return String((await SecureStore.getItemAsync(key)) || '').trim();
}

async function setSecureAuthItem(key: string, value: string): Promise<void> {
  if (!(await isSecureStoreAvailable())) {
    throw new Error('Secure credential storage is unavailable on this device');
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteSecureAuthItem(key: string): Promise<void> {
  if (!(await isSecureStoreAvailable())) {
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

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
  mmkvStorage.set(SUPABASE_UID_KEY, uid);
  mmkvStorage.set(SUPABASE_EMAIL_KEY, email || '');
  emitAuthStateChange();
}

function clearAuthCurrentUser() {
  authCurrentUser = null;
  mmkvStorage.remove(SUPABASE_UID_KEY);
  mmkvStorage.remove(SUPABASE_EMAIL_KEY);
  emitAuthStateChange();
}

function readSupabaseConfig() {
  const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }
  return { url, anonKey };
}

async function saveSupabaseSession(payload: SupabaseSessionPayload) {
  const accessToken = String(payload.access_token || '').trim();
  const refreshToken = String(payload.refresh_token || '').trim();
  const expiresAt = Number(payload.expires_at || 0);
  const uid = String(payload.user?.id || '').trim();
  const email = typeof payload.user?.email === 'string' ? payload.user.email : null;
  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || !uid) {
    throw new Error('Supabase session payload is invalid');
  }

  await Promise.all([
    setSecureAuthItem(SUPABASE_ACCESS_TOKEN_KEY, accessToken),
    setSecureAuthItem(SUPABASE_REFRESH_TOKEN_KEY, refreshToken),
    setSecureAuthItem(SUPABASE_EXPIRES_AT_KEY, String(expiresAt)),
  ]);
  setAuthCurrentUser(uid, email);
}

export async function signInSupabaseAuthTransport(email: string, password: string): Promise<void> {
  const { url, anonKey } = readSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => null) as SupabaseSessionPayload | null;
  if (!response.ok || !payload) {
    throw new Error(String(payload?.error_description || payload?.msg || 'Supabase sign-in failed'));
  }

  await saveSupabaseSession(payload);
}

export async function getSupabaseAuthTransportToken(forceRefresh = true): Promise<string | null> {
  const accessToken = await getSecureAuthItem(SUPABASE_ACCESS_TOKEN_KEY);
  if (!accessToken) {
    return null;
  }

  if (!forceRefresh) {
    return accessToken;
  }

  const expiresAt = Number(await getSecureAuthItem(SUPABASE_EXPIRES_AT_KEY) || 0);
  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(expiresAt) && expiresAt > now + 30) {
    return accessToken;
  }

  const refreshToken = await getSecureAuthItem(SUPABASE_REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    return null;
  }

  const { url, anonKey } = readSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const payload = await response.json().catch(() => null) as SupabaseSessionPayload | null;
  if (!response.ok || !payload) {
    await clearSupabaseAuthTransportSession();
    return null;
  }

  await saveSupabaseSession(payload);
  return String(payload.access_token || '').trim() || null;
}

export async function clearSupabaseAuthTransportSession(): Promise<void> {
  await Promise.all([
    deleteSecureAuthItem(SUPABASE_ACCESS_TOKEN_KEY),
    deleteSecureAuthItem(SUPABASE_REFRESH_TOKEN_KEY),
    deleteSecureAuthItem(SUPABASE_EXPIRES_AT_KEY),
  ]);
  clearAuthCurrentUser();
}

const cachedUid = String(mmkvStorage.getString(SUPABASE_UID_KEY) || '').trim();
if (cachedUid) {
  const cachedEmail = String(mmkvStorage.getString(SUPABASE_EMAIL_KEY) || '').trim() || null;
  authCurrentUser = toSupabaseAuthUser(cachedUid, cachedEmail);
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
  if (operation === 'createInviteV1') {
    return { edgePath: 'invites-create' };
  }

  if (operation === 'joinCompanyV1') {
    return { edgePath: 'invites-join' };
  }

  if (operation === 'requestUpgradeV1') {
    return { edgePath: 'upgrades-request' };
  }

  if (operation === 'listUpgradeRequestsV1') {
    return { edgePath: 'upgrades-list' };
  }

  if (operation === 'moderateUpgradeRequestV1') {
    return { edgePath: 'upgrades-moderate' };
  }

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

// Firestore helper exports (modular API)
export const Timestamp = FirestoreTimestamp;
export const FieldValue = FirestoreFieldValue;
export const GeoPoint = FirestoreGeoPoint;

// Keep generic Firestore write primitives out of the shared barrel so protected
// business writes remain visibly intentional at each direct-write call site.
export {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  increment,
  serverTimestamp,
};

// Re-export Auth modular functions (wrapped to preserve API surface)
export async function signInWithEmailAndPassword(authInstance: any, email: string, password: string) {
  void authInstance;
  await signInSupabaseAuthTransport(email, password);
  return { user: auth.currentUser };
}

export async function signOut(authInstance: any) {
  void authInstance;
  const token = await getSupabaseAuthTransportToken(false);
  if (token) {
    try {
      const { url, anonKey } = readSupabaseConfig();
      await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
      });
    } catch {
      // Best effort logout; local session is always cleared.
    }
  }
  await clearSupabaseAuthTransportSession();
}

export function onAuthStateChanged(authInstance: any, listener: (user: any) => void) {
  void authInstance;
  authListeners.add(listener);
  listener(auth.currentUser);
  return () => {
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
