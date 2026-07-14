import {
  JobListQuerySchema,
  type JobSummary,
} from '@smart-job/api-contracts';

import type { Job, JobStatusValue } from '../../../types';

const JOB_STATUS_ORDER: Readonly<Record<JobStatusValue, number>> = {
  pending: 0,
  waiting: 1,
  finished: 2,
  denied: 3,
};

export interface JobListFilters {
  readonly status?: JobStatusValue | readonly JobStatusValue[];
  readonly dateFrom?: Date | string;
  readonly dateTo?: Date | string;
  readonly creatorUid?: string;
  readonly search?: string;
  readonly pageSize?: number;
}

export interface NormalizedJobListFilters {
  readonly statuses: readonly JobStatusValue[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly creatorUid?: string;
  readonly search?: string;
  readonly pageSize: number;
}

export type MobileJobSummary = Job & {
  readonly jobNo: number;
  readonly entityVersion: string;
  readonly dueDate?: string;
  readonly deniedAt?: string;
};

function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('The job date filter is invalid');
  }
  return date.toISOString();
}

function canonicalStatuses(
  value: JobStatusValue | readonly JobStatusValue[] | undefined,
): readonly JobStatusValue[] {
  const statuses = value === undefined
    ? []
    : typeof value === 'string'
      ? [value]
      : [...value];
  return [...new Set(statuses)].sort(
    (left, right) => JOB_STATUS_ORDER[left] - JOB_STATUS_ORDER[right],
  );
}

export function normalizeJobListFilters(
  filters: JobListFilters = {},
): NormalizedJobListFilters {
  const statuses = canonicalStatuses(filters.status);
  const dateFrom = toIso(filters.dateFrom);
  const dateTo = toIso(filters.dateTo);
  const creatorUid = filters.creatorUid?.trim() || undefined;
  const search = filters.search?.trim() || undefined;
  const pageSize = filters.pageSize ?? 50;

  JobListQuerySchema.parse({
    status: statuses.length > 0 ? statuses : undefined,
    dateFrom,
    dateTo,
    creatorUid,
    search,
    pageSize,
  });

  return {
    statuses,
    dateFrom,
    dateTo,
    creatorUid,
    search,
    pageSize,
  };
}

export function buildJobListPath(
  companyId: number,
  filters: NormalizedJobListFilters,
  afterCursor: string | null = null,
): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to list jobs');
  }

  JobListQuerySchema.parse({
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    creatorUid: filters.creatorUid,
    search: filters.search,
    pageSize: filters.pageSize,
    afterCursor: afterCursor || undefined,
  });

  const searchParams = new URLSearchParams();
  for (const status of filters.statuses) {
    searchParams.append('status', status);
  }
  if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) searchParams.set('dateTo', filters.dateTo);
  if (filters.creatorUid) searchParams.set('creatorUid', filters.creatorUid);
  if (filters.search) searchParams.set('search', filters.search);
  searchParams.set('pageSize', String(filters.pageSize));
  if (afterCursor) searchParams.set('afterCursor', afterCursor);

  return `/api/v1/companies/${companyId}/jobs?${searchParams.toString()}`;
}

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

export function mapJobSummary(summary: JobSummary): MobileJobSummary {
  return {
    id: summary.jobId,
    jobNo: summary.jobNo,
    entityVersion: summary.entityVersion,
    status: summary.status,
    title: summary.title,
    description: summary.description,
    notes: optional(summary.notes),
    location: optional(summary.location),
    address: optional(summary.address),
    dueDate: optional(summary.dueAt),
    cid: optional(summary.client?.id ?? null),
    cname: optional(summary.client?.name ?? null),
    cphone: optional(summary.client?.phone ?? null),
    wid: optional(summary.assignee?.memberNo ?? null),
    wname: optional(summary.assignee?.displayName ?? null),
    mid: optional(summary.creator?.memberNo ?? null),
    mname: optional(summary.creator?.displayName ?? null),
    isCert: summary.isCertificate,
    timeFrom: optional(summary.timeFrom),
    timeTo: optional(summary.timeTo),
    signingPerson: optional(summary.signingPerson),
    travelDistance: optional(summary.travelDistance),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    finishedAt: optional(summary.finishedAt),
    deniedAt: optional(summary.deniedAt),
  };
}

export function mergeJobSummaryPages(
  pages: readonly { readonly items: readonly JobSummary[] }[] | undefined,
): MobileJobSummary[] {
  const seen = new Set<string>();
  const jobs: MobileJobSummary[] = [];
  for (const page of pages ?? []) {
    for (const summary of page.items) {
      if (seen.has(summary.jobId)) continue;
      seen.add(summary.jobId);
      jobs.push(mapJobSummary(summary));
    }
  }
  return jobs;
}
