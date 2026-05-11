import type { Job, JobFileRef, JobItem } from '../../../types';
import { scopedKey } from '../../../contexts/mmkv-storage';

export type FillJobMode = 'user' | 'worker';

export type FillJobPart = JobItem & {
  id?: string | number;
  usedQuantity?: number;
};

export type EditableJob = Job & {
  travelDistance?: number | string;
  partsUsed?: FillJobPart[];
  photos?: Array<string | JobFileRef>;
  signature?: string | JobFileRef | null;
};

export type FillJobFormData = {
  title: string;
  timeFrom: string;
  timeTo: string;
  location: string;
  description: string;
  cname: string;
  cphone: string;
  photos: Array<string | JobFileRef>;
  signingPerson: string;
  signature: string | JobFileRef | null;
};

export type FillJobDraft = {
  jobData?: Partial<FillJobFormData>;
  selectedParts?: FillJobPart[];
  travelDistance?: number | string;
  timestamp?: number;
};

export type PendingUserJobRecord = {
  uid?: string;
  localJobId?: string;
  attachmentUploadId?: string;
  jobData?: Record<string, unknown>;
};

export type PendingWorkerJobRecord = {
  companyId?: string;
  jobId?: string;
  jobData?: Record<string, unknown>;
};

export function getFillJobDraftStorageKey(mode: FillJobMode, jobId?: string | null) {
  if (mode === 'user') {
    return scopedKey('userjobDraft');
  }
  const normalizedJobId = String(jobId || '').trim();
  return scopedKey(normalizedJobId ? `workerjobDraft_${normalizedJobId}` : 'workerjobDraft_new');
}

export function getPendingUserJobsStorageKey() {
  return scopedKey('pendingJobs');
}

export function getPendingWorkerJobsStorageKey() {
  return scopedKey('pendingWorkerJobs');
}

// Generate a temporary ID for file upload paths (not used as Firestore doc ID)
export function generateTempId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}
