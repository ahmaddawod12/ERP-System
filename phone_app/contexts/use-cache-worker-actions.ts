import { useCallback } from 'react';
import { CACHE_KEYS } from './mmkv-storage';

interface WorkerActionsParams {
  workers: Record<string, any>;
  getUserRole: () => string | null;
  getCompanyId: () => string | null;
  saveToLocalCache: (key: string, value: unknown) => void;
}

export function useCacheWorkerActions({
  workers,
  getUserRole,
  getCompanyId,
  saveToLocalCache,
}: WorkerActionsParams) {
  const updateWorkers = useCallback(async (newWorkers: any) => {
    saveToLocalCache(CACHE_KEYS.WORKERS, newWorkers);
  }, [saveToLocalCache]);

  const addWorker = useCallback(async (wid: string, workerData: any) => {
    const role = getUserRole();
    const companyId = getCompanyId();
    if (role !== 'manager' || !companyId) {
      throw new Error('Only managers with a companyId can add workers');
    }

    saveToLocalCache(CACHE_KEYS.WORKERS, {
      ...workers,
      [wid]: {
        uid: workerData.uid,
        wid: workerData.wid ?? null,
        email: workerData.email,
        name: workerData.name,
        phoneNumber: workerData.phoneNumber,
        role: 'worker',
        companyId,
      },
    });
  }, [getCompanyId, getUserRole, saveToLocalCache, workers]);

  const editWorker = useCallback(async (wid: string, updates: any) => {
    const role = getUserRole();
    const companyId = getCompanyId();
    if (role !== 'manager' || !companyId) {
      throw new Error('Only managers with a companyId can edit workers');
    }

    const currentWorker = workers[wid];
    if (!currentWorker) {
      throw new Error('Worker not found in cache');
    }

    const { password, ...safeUpdates } = updates || {};
    saveToLocalCache(CACHE_KEYS.WORKERS, {
      ...workers,
      [wid]: {
        ...currentWorker,
        ...safeUpdates,
        email: currentWorker.email,
      },
    });
  }, [getCompanyId, getUserRole, saveToLocalCache, workers]);

  const deleteWorker = useCallback(async (wid: string) => {
    const { [wid]: _deletedWorker, ...remainingWorkers } = workers;
    saveToLocalCache(CACHE_KEYS.WORKERS, remainingWorkers);
  }, [saveToLocalCache, workers]);

  return {
    updateWorkers,
    addWorker,
    editWorker,
    deleteWorker,
  };
}
