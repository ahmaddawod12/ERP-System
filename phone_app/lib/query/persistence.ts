import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { QueryClient } from '@tanstack/react-query';

import { safeJsonParse } from '../../utils/helpers';

const SNAPSHOT_KEY = 'tanstack-query-snapshot-v1';
const LAST_COMPANY_KEY = 'last-company-id';
const MAX_QUERIES = 50;
const MAX_SNAPSHOT_BYTES = 2 * 1_024 * 1_024;
const MAX_QUERY_BYTES = 256 * 1_024;
const PERSIST_DEBOUNCE_MS = 1_000;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const encryptionKeyPromises = new Map<string, Promise<string>>();
const encryptedStorePromises = new Map<string, Promise<MMKV>>();
const encryptedStoreReleasePromises = new Map<string, Promise<void>>();

interface PersistedQuery {
  readonly queryKey: readonly unknown[];
  readonly data: unknown;
  readonly dataUpdatedAt: number;
}

interface QuerySnapshot {
  readonly version: 1;
  readonly uid: string;
  readonly companyId: number;
  readonly queries: readonly PersistedQuery[];
}

function normalizedUserId(uid: string): string {
  const normalized = uid.trim().toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new Error('A canonical authenticated user id is required for query persistence');
  }
  return normalized;
}

async function encryptionKey(uid: string): Promise<string> {
  const normalized = normalizedUserId(uid);
  const active = encryptionKeyPromises.get(normalized);
  if (active) {
    return active;
  }

  const pending = (async () => {
    const keyName = `smart-job.mmkv.key.${normalized}`;
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing && existing.length === 32) {
      return existing;
    }
    const bytes = getRandomBytes(32);
    const generated = Array.from(bytes, (byte) => KEY_ALPHABET[byte & 63]).join('');
    await SecureStore.setItemAsync(keyName, generated, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  encryptionKeyPromises.set(normalized, pending);
  try {
    return await pending;
  } finally {
    if (encryptionKeyPromises.get(normalized) === pending) {
      encryptionKeyPromises.delete(normalized);
    }
  }
}

async function encryptedStore(uid: string): Promise<MMKV> {
  const normalized = normalizedUserId(uid);
  const releasing = encryptedStoreReleasePromises.get(normalized);
  if (releasing) {
    await releasing;
  }
  const active = encryptedStorePromises.get(normalized);
  if (active) {
    return active;
  }

  const pending = encryptionKey(normalized).then((key) => createMMKV({
    id: `smart-job-mobile-${normalized}`,
    encryptionKey: key,
    encryptionType: 'AES-256',
  }));
  encryptedStorePromises.set(normalized, pending);
  pending.catch(() => {
    if (encryptedStorePromises.get(normalized) === pending) {
      encryptedStorePromises.delete(normalized);
    }
  });
  return pending;
}

/**
 * Drop native and JavaScript references to one user's encrypted persistence
 * instance without deleting the durable snapshot or its SecureStore key.
 * New access waits for disposal to finish, which prevents a tenant switch from
 * reusing an MMKV object while it is being released.
 */
export async function releaseEncryptedQueryPersistence(uid: string): Promise<void> {
  const normalized = normalizedUserId(uid);
  const previousRelease = encryptedStoreReleasePromises.get(normalized)
    ?? Promise.resolve();
  const release = previousRelease.then(async () => {
    const storePromise = encryptedStorePromises.get(normalized);
    const keyPromise = encryptionKeyPromises.get(normalized);
    encryptedStorePromises.delete(normalized);
    encryptionKeyPromises.delete(normalized);

    if (storePromise) {
      try {
        const store = await storePromise;
        store.dispose();
      } catch {
        // A failed first open has no usable native resource to release.
      }
      return;
    }

    // If key creation began without a store completing, let the SecureStore
    // write settle before a later open attempts to read or create the key.
    await keyPromise?.catch(() => undefined);
  });

  encryptedStoreReleasePromises.set(normalized, release);
  try {
    await release;
  } finally {
    if (encryptedStoreReleasePromises.get(normalized) === release) {
      encryptedStoreReleasePromises.delete(normalized);
    }
  }
}

export async function readLastCompanyPreference(uid: string): Promise<number | null> {
  const value = (await encryptedStore(uid)).getNumber(LAST_COMPANY_KEY);
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function writeLastCompanyPreference(
  uid: string,
  companyId: number,
): Promise<void> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A positive public company id is required');
  }
  (await encryptedStore(uid)).set(LAST_COMPANY_KEY, companyId);
}

function isTenantQuery(
  queryKey: readonly unknown[],
  uid: string,
  companyId: number,
): boolean {
  return queryKey[0] === 'tenant' && queryKey[1] === uid && queryKey[2] === companyId;
}

function createSnapshot(
  queryClient: QueryClient,
  uid: string,
  companyId: number,
): QuerySnapshot {
  let totalBytes = 0;
  const queries: PersistedQuery[] = [];
  const candidates = queryClient.getQueryCache().getAll()
    .filter((query) => (
      query.state.status === 'success'
      && query.state.data !== undefined
      && isTenantQuery(query.queryKey, uid, companyId)
    ))
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt);

  for (const query of candidates) {
    if (queries.length >= MAX_QUERIES) {
      break;
    }
    const persisted: PersistedQuery = {
      queryKey: query.queryKey,
      data: query.state.data,
      dataUpdatedAt: query.state.dataUpdatedAt,
    };
    let serialized: string;
    try {
      serialized = JSON.stringify(persisted);
    } catch {
      continue;
    }
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_QUERY_BYTES || totalBytes + bytes > MAX_SNAPSHOT_BYTES) {
      continue;
    }
    totalBytes += bytes;
    queries.push(persisted);
  }

  return { version: 1, uid, companyId, queries };
}

function isSnapshot(value: unknown, uid: string, companyId: number): value is QuerySnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<QuerySnapshot>;
  return candidate.version === 1
    && candidate.uid === uid
    && candidate.companyId === companyId
    && Array.isArray(candidate.queries)
    && candidate.queries.length <= MAX_QUERIES;
}

export async function startEncryptedQueryPersistence(input: {
  readonly queryClient: QueryClient;
  readonly uid: string;
  readonly companyId: number;
}): Promise<() => void> {
  const storage = await encryptedStore(input.uid);
  const restored = safeJsonParse<unknown>(storage.getString(SNAPSHOT_KEY));
  if (isSnapshot(restored, input.uid, input.companyId)) {
    for (const query of restored.queries) {
      if (!Array.isArray(query.queryKey) || !isTenantQuery(query.queryKey, input.uid, input.companyId)) {
        continue;
      }
      const restoredUpdatedAt = Number.isFinite(query.dataUpdatedAt)
        ? query.dataUpdatedAt
        : 0;
      const current = input.queryClient.getQueryState(query.queryKey);
      if (current && current.dataUpdatedAt >= restoredUpdatedAt) {
        continue;
      }
      input.queryClient.setQueryData(query.queryKey, query.data, {
        updatedAt: restoredUpdatedAt || Date.now(),
      });
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    const snapshot = createSnapshot(input.queryClient, input.uid, input.companyId);
    const serialized = JSON.stringify(snapshot);
    if (new TextEncoder().encode(serialized).byteLength <= MAX_SNAPSHOT_BYTES) {
      storage.set(SNAPSHOT_KEY, serialized);
    }
  };
  const persist = () => {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, PERSIST_DEBOUNCE_MS);
  };
  const unsubscribe = input.queryClient.getQueryCache().subscribe((event) => {
    if (event?.query && isTenantQuery(event.query.queryKey, input.uid, input.companyId)) {
      persist();
    }
  });

  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  };
}
