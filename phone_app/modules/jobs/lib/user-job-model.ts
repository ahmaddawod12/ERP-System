import type { DateLike, Job, JobItem } from '../../../types';

export type UserJobRecord = Job & {
  isCert?: boolean;
  customer?: string;
  partsUsed?: JobItem[];
};

export function getDateLikeTime(value: DateLike | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}

export function isUserJobNew(job: UserJobRecord, now = Date.now()): boolean {
  if (!job.finishedAt && !job.createdAt) return false;
  const jobDate = getDateLikeTime(job.finishedAt || job.createdAt);
  const hoursDiff = (now - jobDate) / (1000 * 60 * 60);
  return hoursDiff <= 24;
}

export function canEditUserJob(job: UserJobRecord, now = Date.now()): boolean {
  if (job.isCert === true) return false;
  if (job.finishedAt) {
    const finishedDateMs = getDateLikeTime(job.finishedAt);
    const daysDiff = (now - finishedDateMs) / (1000 * 60 * 60 * 24);
    if (daysDiff > 7) return false;
  }
  return true;
}

export function canDeleteUserJob(job: UserJobRecord): boolean {
  return job.isCert !== true;
}

export function getUserJobStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'finished': return '#10b981';
    case 'pending': return '#f59e0b';
    case 'denied': return '#ef4444';
    default: return '#6b7280';
  }
}

export function formatUserJobDate(timestamp: DateLike | null | undefined): string {
  if (!timestamp) return 'N/A';
  const date = typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
    ? (timestamp as { toDate: () => Date }).toDate()
    : new Date(String(timestamp));
  return date.toLocaleDateString();
}
