import {
  DEFAULT_INVENTORY_PAGE_SIZE,
  InventoryListQuerySchema,
  MAX_INVENTORY_PAGE_SIZE,
  type InventoryPartStatus,
  type InventoryPartSummary,
  type WorkspaceSummary,
} from '@smart-job/api-contracts';

import type { InventoryPart } from '../../../types';

export const MAX_INVENTORY_SEARCH_LENGTH = 80;

const INVENTORY_STATUS_ORDER: Readonly<Record<InventoryPartStatus, number>> = {
  active: 0,
  inactive: 1,
  archived: 2,
};

export type InventoryReadScope = 'company' | 'member';

export interface InventoryListFilters {
  readonly status?: InventoryPartStatus | readonly InventoryPartStatus[];
  readonly search?: string;
  readonly pageSize?: number;
}

export interface NormalizedInventoryListFilters {
  readonly statuses: readonly InventoryPartStatus[];
  readonly search?: string;
  readonly pageSize: number;
}

export type MobileInventoryPart = InventoryPart & {
  readonly partId: string;
  readonly partNo: number;
  readonly status: InventoryPartStatus;
  readonly entityVersion: InventoryPartSummary['entityVersion'];
  readonly stockEntityVersion: InventoryPartSummary['stockEntityVersion'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
};

export function resolveInventoryReadScope(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
): InventoryReadScope | null {
  if (!workspace?.enabledModules.includes('inventory')) {
    return null;
  }
  if (workspace.role === 'worker') {
    return 'member';
  }
  if (workspace.role === 'manager' || workspace.role === 'user' || workspace.role === 'dev') {
    return 'company';
  }
  return null;
}

function normalizedStatuses(
  value: InventoryListFilters['status'],
): readonly InventoryPartStatus[] {
  const statuses = value === undefined
    ? []
    : typeof value === 'string'
      ? [value]
      : [...value];
  return [...new Set(statuses)].sort(
    (left, right) => INVENTORY_STATUS_ORDER[left] - INVENTORY_STATUS_ORDER[right],
  );
}

function boundedPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_INVENTORY_PAGE_SIZE;
  }
  return Math.min(MAX_INVENTORY_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

export function normalizeInventoryListFilters(
  filters: InventoryListFilters = {},
): NormalizedInventoryListFilters {
  const statuses = normalizedStatuses(filters.status);
  const search = filters.search?.trim().slice(0, MAX_INVENTORY_SEARCH_LENGTH) || undefined;
  const pageSize = boundedPageSize(filters.pageSize);

  InventoryListQuerySchema.parse({
    status: statuses.length > 0 ? statuses : undefined,
    search,
    pageSize,
  });
  return { statuses, search, pageSize };
}

export function buildInventoryListPath(
  companyId: number,
  scope: InventoryReadScope,
  filters: NormalizedInventoryListFilters,
  afterCursor: string | null = null,
): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to list inventory');
  }

  InventoryListQuerySchema.parse({
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    search: filters.search,
    pageSize: filters.pageSize,
    afterCursor: afterCursor || undefined,
  });

  const searchParams = new URLSearchParams();
  for (const status of filters.statuses) {
    searchParams.append('status', status);
  }
  if (filters.search) {
    searchParams.set('search', filters.search);
  }
  searchParams.set('pageSize', String(filters.pageSize));
  if (afterCursor) {
    searchParams.set('afterCursor', afterCursor);
  }

  const suffix = scope === 'member' ? '/me' : '';
  return `/api/v1/companies/${companyId}/inventory${suffix}?${searchParams.toString()}`;
}

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

export function mapInventoryPartSummary(
  summary: InventoryPartSummary,
): MobileInventoryPart {
  return {
    id: summary.partNo,
    partId: summary.partId,
    partNo: summary.partNo,
    status: summary.status,
    entityVersion: summary.entityVersion,
    stockEntityVersion: summary.stockEntityVersion,
    name: summary.name,
    active: summary.active,
    quantity: summary.quantity,
    lowThreshold: summary.lowThreshold,
    unit: optional(summary.unit),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    archivedAt: optional(summary.archivedAt),
  };
}

export function mergeInventoryPartPages(
  pages: readonly { readonly items: readonly InventoryPartSummary[] }[] | undefined,
): MobileInventoryPart[] {
  const seen = new Set<string>();
  const parts: MobileInventoryPart[] = [];
  for (const page of pages ?? []) {
    for (const summary of page.items) {
      if (seen.has(summary.partId)) {
        continue;
      }
      seen.add(summary.partId);
      parts.push(mapInventoryPartSummary(summary));
    }
  }
  return parts;
}
