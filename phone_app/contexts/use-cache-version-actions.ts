import { useCallback } from 'react';
import { CACHE_KEYS } from './mmkv-storage';

interface VersionActionsParams {
  getUid: () => string | null;
  getCompanyId: () => string | null;
  saveToLocalCache: (key: string, value: unknown) => void;
  preIncrementVersion: (field: string, isCompanyCache?: boolean) => void;
}

export function useCacheVersionActions({
  saveToLocalCache,
  preIncrementVersion,
}: VersionActionsParams) {
  const incrementCacheVersion = useCallback(async (field: string, isCompanyCache = false) => {
    preIncrementVersion(field, isCompanyCache);
  }, [preIncrementVersion]);

  const updateProfile = useCallback(async (newProfile: unknown) => {
    saveToLocalCache(CACHE_KEYS.PROFILE, newProfile);
    await incrementCacheVersion('profile', false);
  }, [incrementCacheVersion, saveToLocalCache]);

  const updateInventory = useCallback(async (newInventory: unknown) => {
    saveToLocalCache(CACHE_KEYS.INVENTORY, newInventory);
  }, [saveToLocalCache]);

  return {
    incrementCacheVersion,
    updateProfile,
    updateInventory,
  };
}
