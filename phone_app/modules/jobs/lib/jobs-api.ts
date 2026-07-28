import {
  JobAcceptRequestSchema,
  JobAcceptResultSchema,
  JobCreateRequestSchema,
  JobCreateResultSchema,
  JobDeleteRequestSchema,
  JobDeleteResultSchema,
  JobAttachmentDownloadAccessSchema,
  JobDetailSchema,
  JobListPageSchema,
  JobUpdateRequestSchema,
  JobUpdateResultSchema,
  type CursorPage,
  type JobAcceptRequest,
  type JobAcceptResult,
  type JobCreateRequest,
  type JobCreateResult,
  type JobDeleteRequest,
  type JobDeleteResult,
  type JobAttachmentDownloadAccess,
  type JobDetail,
  type JobSummary,
  type JobUpdateRequest,
  type JobUpdateResult,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildJobListPath,
  type NormalizedJobListFilters,
} from './job-list-model';

export function fetchJobsPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly filters: NormalizedJobListFilters;
  readonly afterCursor?: string | null;
  readonly signal?: AbortSignal;
}): Promise<CursorPage<JobSummary>> {
  return requestApi(
    buildJobListPath(input.companyId, input.filters, input.afterCursor ?? null),
    JobListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export function fetchJobDetail(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly jobId: string;
  readonly signal?: AbortSignal;
}): Promise<JobDetail> {
  return requestApi(
    companyJobPath(input.companyId, input.jobId),
    JobDetailSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export function createJobAttachmentDownload(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly jobId: string;
  readonly attachmentId: string;
  readonly signal?: AbortSignal;
}): Promise<JobAttachmentDownloadAccess> {
  const attachmentId = input.attachmentId.trim();
  if (!attachmentId) {
    throw new Error('A valid attachment is required');
  }
  return requestApi(
    `${companyJobPath(input.companyId, input.jobId)}/attachments/${
      encodeURIComponent(attachmentId)
    }/download`,
    JobAttachmentDownloadAccessSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

function companyJobsPath(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to manage jobs');
  }
  return `/api/v1/companies/${companyId}/jobs`;
}

function companyJobPath(companyId: number, jobId: string): string {
  const normalizedJobId = jobId.trim();
  if (!normalizedJobId) {
    throw new Error('A valid job is required');
  }
  return `${companyJobsPath(companyId)}/${encodeURIComponent(normalizedJobId)}`;
}

export function createJob(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly request: JobCreateRequest;
  readonly idempotencyKey: string;
}): Promise<JobCreateResult> {
  return requestApi(
    companyJobsPath(input.companyId),
    JobCreateResultSchema,
    {
      method: 'POST',
      body: JobCreateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function updateJob(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly jobId: string;
  readonly request: JobUpdateRequest;
  readonly idempotencyKey: string;
}): Promise<JobUpdateResult> {
  return requestApi(
    companyJobPath(input.companyId, input.jobId),
    JobUpdateResultSchema,
    {
      method: 'PATCH',
      body: JobUpdateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function acceptJob(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly jobId: string;
  readonly request: JobAcceptRequest;
  readonly idempotencyKey: string;
}): Promise<JobAcceptResult> {
  return requestApi(
    `${companyJobPath(input.companyId, input.jobId)}/accept`,
    JobAcceptResultSchema,
    {
      method: 'POST',
      body: JobAcceptRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function deleteJob(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly jobId: string;
  readonly request: JobDeleteRequest;
  readonly idempotencyKey: string;
}): Promise<JobDeleteResult> {
  return requestApi(
    companyJobPath(input.companyId, input.jobId),
    JobDeleteResultSchema,
    {
      method: 'DELETE',
      body: JobDeleteRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
