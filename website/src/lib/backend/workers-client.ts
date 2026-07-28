import "server-only";

import {
  WorkerListPageSchema,
  WorkerSummarySchema,
  type WebSessionToken,
  type WorkerListQuery,
  type WorkerSummary,
  type WorkerUpdateRequest,
} from "@smart-job/api-contracts";
import type { z } from "zod";

import { buildCompanyWorkersApiPath } from "../dal/workers-query";
import { backendRequest } from "./transport";

export type CompanyWorkersPage = z.infer<typeof WorkerListPageSchema>;

export interface UpdatedWorkerMembership extends WorkerSummary {
  readonly requestId: string;
}

function workerMembershipPath(companyId: number, memberNo: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
  if (!Number.isSafeInteger(memberNo) || memberNo <= 0) {
    throw new Error("A positive member number is required");
  }
  return `/api/v1/companies/${companyId}/workers/${memberNo}`;
}

export async function getCompanyWorkers(
  companyId: number,
  sessionToken: WebSessionToken,
  query: WorkerListQuery,
): Promise<CompanyWorkersPage> {
  const result = await backendRequest(
    buildCompanyWorkersApiPath(companyId, query),
    WorkerListPageSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );

  if ((result.meta.nextCursor ?? null) !== result.data.nextCursor) {
    throw new Error("The backend returned inconsistent worker pagination metadata");
  }
  return result.data;
}

export async function updateCompanyWorker(
  companyId: number,
  memberNo: number,
  input: WorkerUpdateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<UpdatedWorkerMembership> {
  const result = await backendRequest(
    workerMembershipPath(companyId, memberNo),
    WorkerSummarySchema,
    {
      method: "PATCH",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  if (result.data.memberNo !== memberNo) {
    throw new Error("The backend returned a mismatched team member");
  }
  return { ...result.data, requestId: result.meta.requestId };
}

export async function disableCompanyWorker(
  companyId: number,
  memberNo: number,
  entityVersion: WorkerSummary["entityVersion"],
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<UpdatedWorkerMembership> {
  const result = await backendRequest(
    workerMembershipPath(companyId, memberNo),
    WorkerSummarySchema,
    {
      method: "DELETE",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ entityVersion }),
    },
  );
  if (result.data.memberNo !== memberNo) {
    throw new Error("The backend returned a mismatched team member");
  }
  return { ...result.data, requestId: result.meta.requestId };
}
