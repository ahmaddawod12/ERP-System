import type { Job, JobFileRef, JobItem } from '../../../types';
import { scopedKey } from '../../../contexts/mmkv-storage';
import { generateUuid } from '../../../utils/helpers';

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

export type FillJobValidationCode =
  | 'missing-fields'
  | 'invalid-time'
  | 'missing-photo'
  | 'missing-signature';

function minutesFromTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function validateFillJobForm(
  mode: FillJobMode,
  form: FillJobFormData,
): FillJobValidationCode | null {
  const missingUserFields = mode === 'user'
    && (!form.title.trim() || !form.location.trim() || !form.description.trim() || !form.cname.trim());
  if (missingUserFields || !form.timeFrom || !form.timeTo || !form.signingPerson.trim()) {
    return 'missing-fields';
  }

  const startMinutes = minutesFromTime(form.timeFrom);
  const endMinutes = minutesFromTime(form.timeTo);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return 'invalid-time';
  }
  if (form.photos.length === 0) return 'missing-photo';
  if (!form.signature) return 'missing-signature';
  return null;
}

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

// Generate a temporary ID for file upload paths (not used as the backend record ID)
export function generateTempId() {
  return generateUuid().replace(/-/g, '').slice(0, 8);
}
