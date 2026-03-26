function normalizeCacheIdentityValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function resolveCachedSessionIdentity({
  expectedUid,
  cachedUid,
  cachedRole,
  cachedCompanyId,
}) {
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

function isProfileCacheOwnedByUser(profile, uid) {
  if (!profile || !uid) return true;
  const profileUid = normalizeCacheIdentityValue(profile.uid);
  return !profileUid || profileUid === uid;
}

module.exports = {
  normalizeCacheIdentityValue,
  resolveCachedSessionIdentity,
  isProfileCacheOwnedByUser,
};
