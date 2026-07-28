import {
  ClientListQuerySchema,
  DEFAULT_CLIENT_PAGE_SIZE,
  MAX_CLIENT_PAGE_SIZE,
  type ClientStatus,
  type ClientStatusFilter,
  type ClientSummary,
} from '@smart-job/api-contracts';

import type { Client } from '../../../types';

export const MAX_CLIENT_SEARCH_LENGTH = 80;

export interface ClientListFilters {
  readonly search?: string;
  readonly status?: ClientStatusFilter;
  readonly pageSize?: number;
}

export interface NormalizedClientListFilters {
  readonly search?: string;
  readonly status: ClientStatusFilter;
  readonly pageSize: number;
}

export type MobileClientSummary = Client & {
  readonly clientNo: number;
  readonly entityVersion: string;
  readonly status: ClientStatus;
  readonly archivedAt?: string;
};

function boundedPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CLIENT_PAGE_SIZE;
  }
  return Math.min(MAX_CLIENT_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

export function normalizeClientListFilters(
  filters: ClientListFilters = {},
): NormalizedClientListFilters {
  const search = filters.search?.trim().slice(0, MAX_CLIENT_SEARCH_LENGTH) || undefined;
  const status = filters.status ?? 'active';
  const pageSize = boundedPageSize(filters.pageSize);

  ClientListQuerySchema.parse({ search, status, pageSize });
  return { search, status, pageSize };
}

export function buildClientListPath(
  companyId: number,
  filters: NormalizedClientListFilters,
  afterCursor: string | null = null,
): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to list clients');
  }

  ClientListQuerySchema.parse({
    search: filters.search,
    status: filters.status,
    pageSize: filters.pageSize,
    afterCursor: afterCursor || undefined,
  });

  const searchParams = new URLSearchParams();
  if (filters.search) {
    searchParams.set('search', filters.search);
  }
  searchParams.set('status', filters.status);
  searchParams.set('pageSize', String(filters.pageSize));
  if (afterCursor) {
    searchParams.set('afterCursor', afterCursor);
  }

  return `/api/v1/companies/${companyId}/clients?${searchParams.toString()}`;
}

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

export function mapClientSummary(summary: ClientSummary): MobileClientSummary {
  return {
    id: summary.clientId,
    clientNo: summary.clientNo,
    entityVersion: summary.entityVersion,
    cid: summary.clientNo,
    status: summary.status,
    cname: summary.name,
    name: summary.name,
    cphone: optional(summary.phone),
    phone: optional(summary.phone),
    email: optional(summary.email),
    address: optional(summary.address),
    city: optional(summary.city),
    vatNumber: optional(summary.vatNumber),
    notes: optional(summary.notes),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    archivedAt: optional(summary.archivedAt),
  };
}

export function mergeClientSummaryPages(
  pages: readonly { readonly items: readonly ClientSummary[] }[] | undefined,
): MobileClientSummary[] {
  const seen = new Set<string>();
  const clients: MobileClientSummary[] = [];
  for (const page of pages ?? []) {
    for (const summary of page.items) {
      if (seen.has(summary.clientId)) {
        continue;
      }
      seen.add(summary.clientId);
      clients.push(mapClientSummary(summary));
    }
  }
  return clients;
}
