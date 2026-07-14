import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus } from 'react-native';
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

const AUTH_STORAGE_KEY = 'smart-job.supabase.auth';
const REFRESH_SKEW_SECONDS = 30;

let client: SupabaseClient | null = null;
let secureStoreAvailability: Promise<boolean> | null = null;
let refreshFlight: {
  readonly userId: string;
  readonly promise: Promise<Session | null>;
} | null = null;
let lifecycleInstalled = false;

function hasVerifiedEmail(session: Session | null): session is Session {
  return Boolean(session?.user.email_confirmed_at);
}

function readSupabaseConfig(): { url: string; publishableKey: string } {
  const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const publishableKey = String(
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  ).trim();

  if (!url || !publishableKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  }

  return { url, publishableKey };
}

async function requireSecureStore(): Promise<void> {
  secureStoreAvailability ??= SecureStore.isAvailableAsync().catch(() => false);
  if (!(await secureStoreAvailability)) {
    throw new Error('Secure credential storage is unavailable on this device');
  }
}

const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    await requireSecureStore();
    return SecureStore.getItemAsync(`${AUTH_STORAGE_KEY}.${key}`);
  },
  async setItem(key: string, value: string): Promise<void> {
    await requireSecureStore();
    await SecureStore.setItemAsync(`${AUTH_STORAGE_KEY}.${key}`, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string): Promise<void> {
    await requireSecureStore();
    await SecureStore.deleteItemAsync(`${AUTH_STORAGE_KEY}.${key}`);
  },
};

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const config = readSupabaseConfig();
  client = createClient(config.url, config.publishableKey, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  return client;
}

async function updateRefreshLifecycle(state: AppStateStatus): Promise<void> {
  const supabase = getSupabaseClient();
  if (state === 'active') {
    await supabase.auth.startAutoRefresh();
    return;
  }
  await supabase.auth.stopAutoRefresh();
}

export function installSupabaseAuthLifecycle(): () => void {
  if (lifecycleInstalled) {
    return () => undefined;
  }

  lifecycleInstalled = true;
  void updateRefreshLifecycle(AppState.currentState);
  const subscription = AppState.addEventListener('change', (state) => {
    void updateRefreshLifecycle(state);
  });

  return () => {
    lifecycleInstalled = false;
    subscription.remove();
    void getSupabaseClient().auth.stopAutoRefresh();
  };
}

export async function restoreSupabaseSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    throw error;
  }
  if (data.session && !hasVerifiedEmail(data.session)) {
    await getSupabaseClient().auth.signOut({ scope: 'local' });
    return null;
  }
  return data.session;
}

export async function signInSupabase(
  email: string,
  password: string,
): Promise<Session> {
  await refreshFlight?.promise.catch(() => null);
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('Supabase did not establish a session');
  }
  if (!hasVerifiedEmail(data.session)) {
    await getSupabaseClient().auth.signOut({ scope: 'local' });
    throw new Error('Verify your email before signing in to the mobile app');
  }
  return data.session;
}

export async function signOutSupabase(): Promise<void> {
  await refreshFlight?.promise.catch(() => null);
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
  if (error) {
    throw error;
  }
}

async function refreshSessionSingleFlight(expectedUserId: string): Promise<Session | null> {
  const active = refreshFlight;
  if (active) {
    const refreshed = await active.promise;
    if (active.userId === expectedUserId) {
      return refreshed?.user.id === expectedUserId ? refreshed : null;
    }
    return refreshSessionSingleFlight(expectedUserId);
  }

  const promise = getSupabaseClient().auth.refreshSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }
        return data.session?.user.id === expectedUserId ? data.session : null;
      })
      .finally(() => {
        if (refreshFlight?.promise === promise) {
          refreshFlight = null;
        }
      });
  refreshFlight = { userId: expectedUserId, promise };
  return promise;
}

export async function getSupabaseAccessToken(
  refreshIfExpiring = true,
): Promise<string | null> {
  const session = await restoreSupabaseSession();
  if (!hasVerifiedEmail(session)) {
    return null;
  }

  const expiresAt = Number(session.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  if (
    !refreshIfExpiring
    || (Number.isFinite(expiresAt) && expiresAt > now + REFRESH_SKEW_SECONDS)
  ) {
    return session.access_token;
  }

  const refreshed = await refreshSessionSingleFlight(session.user.id);
  return refreshed?.access_token ?? null;
}

export function subscribeSupabaseAuth(
  listener: (session: Session | null, user: User | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    if (session && !hasVerifiedEmail(session)) {
      listener(null, null);
      void getSupabaseClient().auth.signOut({ scope: 'local' });
      return;
    }
    listener(session, session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
