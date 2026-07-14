import {
  InventoryAdjustmentRequestSchema,
  InventoryListPageSchema,
  InventoryPartArchiveRequestSchema,
  InventoryPartCreateRequestSchema,
  InventoryPartSummarySchema,
  InventoryPartUpdateRequestSchema,
  InventoryPickRequestSchema,
  InventoryPickResultSchema,
  InventoryTransferRequestSchema,
  InventoryTransferResultSchema,
  type CursorPage,
  type InventoryAdjustmentRequest,
  type InventoryPartArchiveRequest,
  type InventoryPartCreateRequest,
  type InventoryPartSummary,
  type InventoryPartUpdateRequest,
  type InventoryPickRequest,
  type InventoryPickResult,
  type InventoryTransferRequest,
  type InventoryTransferResult,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildInventoryListPath,
  type InventoryReadScope,
  type NormalizedInventoryListFilters,
} from './inventory-list-model';

function companyInventoryPath(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to manage inventory');
  }
  return `/api/v1/companies/${companyId}/inventory`;
}

function inventoryPartPath(companyId: number, partId: string): string {
  const normalizedPartId = InventoryPartSummarySchema.shape.partId.parse(partId.trim());
  return `${companyInventoryPath(companyId)}/parts/${encodeURIComponent(normalizedPartId)}`;
}

interface InventoryMutationScope {
  readonly uid: string;
  readonly companyId: number;
  readonly idempotencyKey: string;
}

export function fetchInventoryPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly scope: InventoryReadScope;
  readonly filters: NormalizedInventoryListFilters;
  readonly afterCursor?: string | null;
}): Promise<CursorPage<InventoryPartSummary>> {
  return requestApi(
    buildInventoryListPath(
      input.companyId,
      input.scope,
      input.filters,
      input.afterCursor ?? null,
    ),
    InventoryListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function createInventoryPart(input: InventoryMutationScope & {
  readonly request: InventoryPartCreateRequest;
}): Promise<InventoryPartSummary> {
  return requestApi(
    `${companyInventoryPath(input.companyId)}/parts`,
    InventoryPartSummarySchema,
    {
      method: 'POST',
      body: InventoryPartCreateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function updateInventoryPart(input: InventoryMutationScope & {
  readonly partId: string;
  readonly request: InventoryPartUpdateRequest;
}): Promise<InventoryPartSummary> {
  return requestApi(
    inventoryPartPath(input.companyId, input.partId),
    InventoryPartSummarySchema,
    {
      method: 'PATCH',
      body: InventoryPartUpdateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function archiveInventoryPart(input: InventoryMutationScope & {
  readonly partId: string;
  readonly request: InventoryPartArchiveRequest;
}): Promise<InventoryPartSummary> {
  return requestApi(
    inventoryPartPath(input.companyId, input.partId),
    InventoryPartSummarySchema,
    {
      method: 'DELETE',
      body: InventoryPartArchiveRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function adjustInventoryStock(input: InventoryMutationScope & {
  readonly scope: 'company' | 'member';
  readonly partId: string;
  readonly request: InventoryAdjustmentRequest;
}): Promise<InventoryPartSummary> {
  const scopePath = input.scope === 'member' ? '/me' : '';
  const partId = InventoryPartSummarySchema.shape.partId.parse(input.partId.trim());
  return requestApi(
    `${companyInventoryPath(input.companyId)}${scopePath}/parts/${encodeURIComponent(partId)}/adjustments`,
    InventoryPartSummarySchema,
    {
      method: 'POST',
      body: InventoryAdjustmentRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function transferInventoryStock(input: InventoryMutationScope & {
  readonly request: InventoryTransferRequest;
}): Promise<InventoryTransferResult> {
  return requestApi(
    `${companyInventoryPath(input.companyId)}/transfers`,
    InventoryTransferResultSchema,
    {
      method: 'POST',
      body: InventoryTransferRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function pickInventoryStock(input: InventoryMutationScope & {
  readonly request: InventoryPickRequest;
}): Promise<InventoryPickResult> {
  return requestApi(
    `${companyInventoryPath(input.companyId)}/picks`,
    InventoryPickResultSchema,
    {
      method: 'POST',
      body: InventoryPickRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
