import { useCallback } from 'react';
import { CACHE_KEYS } from './mmkv-storage';
import { logger } from '../utils/logger';
import type { Job } from '../types';

interface JobActionsParams {
  getUserRole: () => string | null;
  jobs: Job[];
  companyJobs: Job[];
  saveToLocalCache: (key: string, value: unknown) => void;
}

export function upsertJob(arr: Job[], job: Job): Job[] {
  return [...arr.filter((item) => item.id !== job.id), job];
}

export function mergeJob(arr: Job[], jobId: string, updates: Partial<Job>): Job[] {
  return arr.map((item) => item.id === jobId ? { ...item, ...updates } : item);
}

export function removeJobById(arr: Job[], jobId: string): Job[] {
  return arr.filter((item) => item.id !== jobId);
}

export function useCacheJobActions({
  getUserRole,
  jobs,
  companyJobs,
  saveToLocalCache,
}: JobActionsParams) {
  const addJob = useCallback((job: Job) => {
    if (!job?.id) {
      logger.error('Cannot add job without ID');
      return;
    }

    const cacheKey = getUserRole() === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
    const current = cacheKey === CACHE_KEYS.COMPANY_JOBS ? companyJobs : jobs;
    saveToLocalCache(cacheKey, upsertJob(current, job));
  }, [companyJobs, getUserRole, jobs, saveToLocalCache]);

  const updateJob = useCallback((jobId: string, updates: Partial<Job>) => {
    const cacheKey = getUserRole() === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
    const current = cacheKey === CACHE_KEYS.COMPANY_JOBS ? companyJobs : jobs;
    saveToLocalCache(cacheKey, mergeJob(current, jobId, updates));
  }, [companyJobs, getUserRole, jobs, saveToLocalCache]);

  const removeJob = useCallback((jobId: string) => {
    const cacheKey = getUserRole() === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
    const current = cacheKey === CACHE_KEYS.COMPANY_JOBS ? companyJobs : jobs;
    saveToLocalCache(cacheKey, removeJobById(current, jobId));
  }, [companyJobs, getUserRole, jobs, saveToLocalCache]);

  const acceptJob = useCallback((jobId: string, updates: Partial<Job> = {}) => {
    const cacheKey = getUserRole() === 'manager' ? CACHE_KEYS.COMPANY_JOBS : CACHE_KEYS.JOBS;
    const current = cacheKey === CACHE_KEYS.COMPANY_JOBS ? companyJobs : jobs;
    saveToLocalCache(cacheKey, mergeJob(current, jobId, updates));
  }, [companyJobs, getUserRole, jobs, saveToLocalCache]);

  return {
    addJob,
    updateJob,
    removeJob,
    acceptJob,
  };
}
