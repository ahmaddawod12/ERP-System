/**
 * mmkv-storage.ts — Pure utility module for MMKV cache operations.
 *
 * Zero React dependencies. Exports the MMKV instance, constants,
 * scoping helpers, and date utilities consumed by CacheContext.
 */

import type { DateLike, MmkvHelpers } from '../types';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { safeJsonParse } from '../utils/helpers';

// MMKV v4.1.1 - https://github.com/mrousavy/react-native-mmkv
import { createMMKV } from 'react-native-mmkv';

function getAuthStorageEncryptionKey(): string {
  const envOverride = String(process.env.EXPO_PUBLIC_MMKV_AUTH_KEY || '').trim();
  if (envOverride) {
    return envOverride;
  }

  const packageId = String(
    Constants.expoConfig?.android?.package
      || Constants.expoConfig?.ios?.bundleIdentifier
      || Constants.expoConfig?.slug
      || 'smart-job-mobile',
  ).trim();
  const runtimeFingerprint = [
    packageId,
    String(Device.brand || '').trim(),
    String(Device.manufacturer || '').trim(),
    String(Device.modelId || '').trim(),
    String(Device.osBuildId || Device.osInternalBuildId || '').trim(),
  ].filter(Boolean);

  return runtimeFingerprint.join(':');
}

// ─── MMKV instance ─────────────────────────────────────────────────────────
export const storage = createMMKV({
  id: 'smart-job-cache'
});

export const authStorage = createMMKV({
  id: 'smart-job-auth',
  encryptionKey: getAuthStorageEncryptionKey(),
});

console.log('🗄 MMKV initialized successfully');

/** For backwards compatibility */
export const getStorage = () => storage;

// ─── Cache key constants ───────────────────────────────────────────────────
export const CACHE_KEYS = Object.freeze({
  // User data
  PROFILE: 'cache_profile',
  INVENTORY: 'cache_inventory',
  
  // Unified jobs (all statuses in one array)
  JOBS: 'cache_jobs',
  COMPANY_JOBS: 'cache_company_jobs',
  
  // Company data (for managers)
  WORKERS: 'cache_workers',
  COMPANY_INVENTORY: 'cache_company_inventory',
  
  // Business data
  DOCUMENTS: 'cache_documents',
  HAS_BUSINESS_INFO: 'cache_has_business_info',
  
  // Clients
  CLIENTS: 'cache_clients',
  
  // Subscription
  SUBSCRIPTION: 'cache_subscription',
  
  // Summary version tracking (mirrors company cache doc)
  COMPANY_VERSIONS: 'cache_company_versions',
  // User cache version tracking
  CACHE_VERSIONS: 'cache_versions',
  
  // Metadata
  LAST_SYNC: 'cache_last_sync',
  USER_ROLE: 'cache_user_role',
  UID: 'cache_uid',
  COMPANY_ID: 'cache_company_id',
  USER_WID: 'cache_user_wid',
  
  // Incremental sync timestamps (C1 optimization)
  JOBS_LAST_SYNC: 'cache_jobs_last_sync',
  DOCS_LAST_SYNC: 'cache_docs_last_sync',

  // Tier 2 query cache (N4 optimization)
  TIER2_CACHE_PREFIX: 'tier2_',
} as const);

export type CacheKey = typeof CACHE_KEYS[keyof typeof CACHE_KEYS];

// ─── Time constants ────────────────────────────────────────────────────────
/** 90 days in milliseconds */
export const CACHE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

/** 180 days in milliseconds (approximate archive boundary - 6 months) */
export const ARCHIVE_BOUNDARY_MS = 180 * 24 * 60 * 60 * 1000;

/** N4: Tier 2 query cache TTL — 5 minutes */
export const TIER2_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── MMKV key scoping (P2-4) ──────────────────────────────────────────────
let _mmkvScopePrefix = '';

/**
 * Set the MMKV scope prefix (called on auth state change).
 * After calling this, all cache reads/writes are namespaced by uid:companyId.
 */
export function setMmkvScope(uid: string | null | undefined, companyId: string | null | undefined): void {
  _mmkvScopePrefix = (uid && companyId) ? `${uid}:${companyId}:` : uid ? `${uid}:` : '';
}

/** Resolve a cache key to its scoped form. Identity keys (UID, COMPANY_ID, USER_ROLE) are not scoped. */
const IDENTITY_KEYS = new Set([CACHE_KEYS.UID, CACHE_KEYS.COMPANY_ID, CACHE_KEYS.USER_ROLE]);
export function scopedKey(key: string): string {
  if (IDENTITY_KEYS.has(key as any)) return key; // identity is global
  return _mmkvScopePrefix + key;
}

// ─── MMKV helpers ──────────────────────────────────────────────────────────
export const mmkvHelpers: MmkvHelpers = {
  getString: (key: string): string | null => {
    try {
      return storage.getString(scopedKey(key)) || null;
    } catch (e) {
      console.error(`MMKV getString error for ${key}:`, e);
      return null;
    }
  },
  
  setString: (key: string, value: string): boolean => {
    try {
      storage.set(scopedKey(key), value);
      return true;
    } catch (e) {
      console.error(`MMKV setString error for ${key}:`, e);
      return false;
    }
  },
  
  getObject: <T = unknown>(key: string): T | null => {
    try {
      const str = storage.getString(scopedKey(key));
      return safeJsonParse<T>(str);
    } catch (e) {
      console.error(`MMKV getObject error for ${key}:`, e);
      return null;
    }
  },
  
  setObject: (key: string, value: unknown): boolean => {
    try {
      storage.set(scopedKey(key), JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`MMKV setObject error for ${key}:`, e);
      return false;
    }
  },
  
  delete: (key: string): boolean => {
    try {
      storage.remove(scopedKey(key));
      return true;
    } catch (e) {
      console.error(`MMKV delete error for ${key}:`, e);
      return false;
    }
  },
  
  clearAll: (): boolean => {
    try {
      storage.clearAll();
      return true;
    } catch (e) {
      console.error('MMKV clearAll error:', e);
      return false;
    }
  },
};

// ─── Date / type utilities ─────────────────────────────────────────────────
/** Get the date that marks the start of the cache range (90 days ago) */
export const getCacheStartDate = () => {
  return new Date(Date.now() - CACHE_EXPIRY_MS);
};

/** Check if a date is within the 90-day cache range */
export const isWithinCacheRange = (date: DateLike | null | undefined): boolean => {
  if (!date) return false;
  const dateMs = date instanceof Date ? date.getTime() : new Date(date as string).getTime();
  return dateMs >= getCacheStartDate().getTime();
};

/**
 * Determine if a document is a "job" or "document" (invoice/proposal/etc.)
 * based on its data fields.
 */
export const getDocumentType = (docData: Record<string, unknown>): 'document' | 'job' | 'unknown' => {
  // Documents have a 'type' field (taxInvoice, priceProposal, refund, returnCertificate)
  if (docData.type && ['taxInvoice', 'priceProposal', 'refund', 'returnCertificate'].includes(docData.type as string)) return 'document';
  // Everything else is a job
  if (docData.status && ['pending', 'waiting', 'finished', 'denied'].includes(docData.status as string)) return 'job';
  return 'unknown';
};
