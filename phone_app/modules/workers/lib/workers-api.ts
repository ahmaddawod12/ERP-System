import {
  InvitationCreateRequestSchema,
  InvitationCreateResultSchema,
  WorkerListPageSchema,
  WorkerSummarySchema,
  WorkerUpdateRequestSchema,
  type CursorPage,
  type InvitationCreateRequest,
  type InvitationCreateResult,
  type WorkerSummary,
  type WorkerUpdateRequest,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';

function workerPath(companyId: number, memberNo: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A positive company ID is required');
  }
  if (!Number.isSafeInteger(memberNo) || memberNo <= 0) {
    throw new Error('A positive member number is required');
  }
  return `/api/v1/companies/${companyId}/workers/${memberNo}`;
}

export function fetchWorkersPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly afterCursor?: string | null;
}): Promise<CursorPage<WorkerSummary>> {
  const query = new URLSearchParams({ pageSize: '50' });
  if (input.afterCursor) query.set('afterCursor', input.afterCursor);
  return requestApi(
    `/api/v1/companies/${input.companyId}/workers?${query.toString()}`,
    WorkerListPageSchema,
    { uid: input.uid, companyId: input.companyId },
  );
}

export function updateWorkerMembership(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly memberNo: number;
  readonly request: WorkerUpdateRequest;
  readonly idempotencyKey: string;
}): Promise<WorkerSummary> {
  const request = WorkerUpdateRequestSchema.parse(input.request);
  return requestApi(
    workerPath(input.companyId, input.memberNo),
    WorkerSummarySchema,
    {
      method: 'PATCH',
      body: request,
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function disableWorkerMembership(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly worker: Pick<WorkerSummary, 'memberNo' | 'entityVersion'>;
  readonly idempotencyKey: string;
}): Promise<WorkerSummary> {
  return requestApi(
    workerPath(input.companyId, input.worker.memberNo),
    WorkerSummarySchema,
    {
      method: 'DELETE',
      body: { entityVersion: input.worker.entityVersion },
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function createWorkerInvitation(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly request: InvitationCreateRequest;
  readonly idempotencyKey: string;
}): Promise<InvitationCreateResult> {
  const request = InvitationCreateRequestSchema.parse(input.request);
  return requestApi(
    `/api/v1/companies/${input.companyId}/invitations`,
    InvitationCreateResultSchema,
    {
      method: 'POST',
      body: request,
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
