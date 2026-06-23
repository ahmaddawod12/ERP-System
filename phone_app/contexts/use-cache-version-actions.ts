import { useCallback } from 'react';
import { functions, httpsCallable } from '../firebase';
import { CACHE_KEYS } from './mmkv-storage';

interface VersionActionsParams {
  getUid: () => string | null;
  getCompanyId: () => string | null;
  saveToLocalCache: (key: string, value: unknown) => void;
  preIncrementVersion: (field: string, isCompanyCache?: boolean) => void;
}

export function useCacheVersionActions({
  getUid,
  getCompanyId,
  saveToLocalCache,
  preIncrementVersion,
}: VersionActionsParams) {
  const incrementCacheVersion = useCallback(async (field: string, isCompanyCache = false) => {
    if (isCompanyCache) {
      preIncrementVersion(field, true);
      return;
    }

    try {
      preIncrementVersion(field, false);
      const updateCacheFn = httpsCallable(functions, 'updateCacheV1');
      await updateCacheFn({
        field,
        isCompanyCache: false,
      });
    } catch (error) {
      console.error(`Error incrementing ${field} version:`, error);
    }
  }, [preIncrementVersion]);

  const updateProfile = useCallback(async (newProfile: unknown) => {
    saveToLocalCache(CACHE_KEYS.PROFILE, newProfile);
    await incrementCacheVersion('profile', false);
  }, [incrementCacheVersion, saveToLocalCache]);

  const updateInventory = useCallback(async (newInventory: unknown) => {
    const uid = getUid();
    const companyId = getCompanyId();
    if (!uid || !companyId) {
      console.error('Cannot update inventory: missing uid/companyId');
      return;
    }

    saveToLocalCache(CACHE_KEYS.INVENTORY, newInventory);

    const updateInventoryFn = httpsCallable(functions, 'updateInventoryV1');
    await updateInventoryFn({
      companyId,
      action: 'replaceParts',
      scope: 'user',
      targetUid: uid,
      parts: Array.isArray(newInventory) ? newInventory : [],
    });
  }, [getCompanyId, getUid, saveToLocalCache]);

  return {
    incrementCacheVersion,
    updateProfile,
    updateInventory,
  };
}
