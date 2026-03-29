import type { CachedSessionIdentity } from '../types';

export function normalizeCacheIdentityValue(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

interface SessionIdentityInput {
  expectedUid: string | null | undefined;
  cachedUid: string | null | undefined;
  cachedRole: string | null | undefined;
  cachedCompanyId: string | null | undefined;
}

export function resolveCachedSessionIdentity({
  expectedUid,
  cachedUid,
  cachedRole,
  cachedCompanyId,
}: SessionIdentityInput): CachedSessionIdentity {
  const authenticatedUid = normalizeCacheIdentityValue(expectedUid);
  const storedUid = normalizeCacheIdentityValue(cachedUid);

  if (authenticatedUid && storedUid && authenticatedUid !== storedUid) {
    return {
      uid: authenticatedUid,
      role: null,
      companyId: null,
      canReadScopedCache: false,
      identityMismatch: true,
    };
  }

  return {
    uid: authenticatedUid || storedUid,
    role: normalizeCacheIdentityValue(cachedRole),
    companyId: normalizeCacheIdentityValue(cachedCompanyId),
    canReadScopedCache: Boolean(authenticatedUid || storedUid),
    identityMismatch: false,
  };
}

export function isProfileCacheOwnedByUser(profile: { uid?: string } | null, uid: string | null): boolean {
  if (!profile || !uid) return true;
  const profileUid = normalizeCacheIdentityValue(profile.uid);
  return !profileUid || profileUid === uid;
}
