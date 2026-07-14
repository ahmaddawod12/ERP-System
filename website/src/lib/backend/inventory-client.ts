import "server-only";

import {
  InventoryAdjustmentRequestSchema,
  InventoryListPageSchema,
  InventoryPartArchiveRequestSchema,
  InventoryPartCreateRequestSchema,
  InventoryPartSummarySchema,
  InventoryPartUpdateRequestSchema,
  type InventoryAdjustmentRequest,
  type InventoryListQuery,
  type InventoryPartArchiveRequest,
  type InventoryPartCreateRequest,
  type InventoryPartSummary,
  type InventoryPartUpdateRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { z, type ZodType } from "zod";
import { backendRequest } from "./transport";
import {
  buildCompanyInventoryApiPath,
  type InventoryReadScope,
} from "../dal/inventory-query";

export type WorkspaceInventoryPage = z.infer<typeof InventoryListPageSchema>;

export interface InventoryMutationResult<T> {
  readonly data: T;
  readonly backendRequestId: string;
}

function assertPublicCompanyId(companyId: number): void {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
}

function assertPartId(partId: string): void {
  if (!z.uuid().safeParse(partId).success) {
    throw new Error("A valid inventory part ID is required");
  }
}

function companyInventoryPath(companyId: number): string {
  assertPublicCompanyId(companyId);
  return `/api/v1/companies/${companyId}/inventory`;
}

function companyInventoryPartPath(companyId: number, partId?: string): string {
  const basePath = `${companyInventoryPath(companyId)}/parts`;
  if (partId === undefined) return basePath;
  assertPartId(partId);
  return `${basePath}/${partId}`;
}

async function mutateInventoryPart<TBody>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  input: TBody,
  inputSchema: ZodType<TBody>,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<InventoryMutationResult<InventoryPartSummary>> {
  const body = inputSchema.parse(input);
  const result = await backendRequest(path, InventoryPartSummarySchema, {
    method,
    headers: {
      Authorization: `SmartJobSession ${sessionToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return { data: result.data, backendRequestId: result.meta.requestId };
}

export async function getWorkspaceInventory(
  companyId: number,
  sessionToken: WebSessionToken,
  scope: InventoryReadScope,
  query: InventoryListQuery,
): Promise<WorkspaceInventoryPage> {
  const result = await backendRequest(
    buildCompanyInventoryApiPath(companyId, scope, query),
    InventoryListPageSchema,
    {
      method: "GET",
      headers: { Authorization: `SmartJobSession ${sessionToken}` },
    },
  );

  if ((result.meta.nextCursor ?? null) !== result.data.nextCursor) {
    throw new Error("The backend returned inconsistent inventory pagination metadata");
  }
  return result.data;
}

export function createCompanyInventoryPart(
  companyId: number,
  input: InventoryPartCreateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<InventoryMutationResult<InventoryPartSummary>> {
  return mutateInventoryPart(
    companyInventoryPartPath(companyId),
    "POST",
    input,
    InventoryPartCreateRequestSchema,
    sessionToken,
    idempotencyKey,
  );
}

export function updateCompanyInventoryPart(
  companyId: number,
  partId: string,
  input: InventoryPartUpdateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<InventoryMutationResult<InventoryPartSummary>> {
  return mutateInventoryPart(
    companyInventoryPartPath(companyId, partId),
    "PATCH",
    input,
    InventoryPartUpdateRequestSchema,
    sessionToken,
    idempotencyKey,
  );
}

export function archiveCompanyInventoryPart(
  companyId: number,
  partId: string,
  input: InventoryPartArchiveRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<InventoryMutationResult<InventoryPartSummary>> {
  return mutateInventoryPart(
    companyInventoryPartPath(companyId, partId),
    "DELETE",
    input,
    InventoryPartArchiveRequestSchema,
    sessionToken,
    idempotencyKey,
  );
}

export function adjustCompanyInventoryPart(
  companyId: number,
  partId: string,
  input: InventoryAdjustmentRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<InventoryMutationResult<InventoryPartSummary>> {
  return mutateInventoryPart(
    `${companyInventoryPartPath(companyId, partId)}/adjustments`,
    "POST",
    input,
    InventoryAdjustmentRequestSchema,
    sessionToken,
    idempotencyKey,
  );
}
