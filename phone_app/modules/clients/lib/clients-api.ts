import {
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteResultSchema,
  ClientListPageSchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  type ClientCreateRequest,
  type ClientDeleteRequest,
  type ClientDeleteResult,
  type ClientSummary,
  type ClientUpdateRequest,
  type CursorPage,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildClientListPath,
  type NormalizedClientListFilters,
} from './client-list-model';

function companyClientsPath(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to manage clients');
  }
  return `/api/v1/companies/${companyId}/clients`;
}

function companyClientPath(companyId: number, clientId: string): string {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) {
    throw new Error('A valid client is required');
  }
  return `${companyClientsPath(companyId)}/${encodeURIComponent(normalizedClientId)}`;
}

export function fetchClientsPage(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly filters: NormalizedClientListFilters;
  readonly afterCursor?: string | null;
  readonly signal?: AbortSignal;
}): Promise<CursorPage<ClientSummary>> {
  return requestApi(
    buildClientListPath(input.companyId, input.filters, input.afterCursor ?? null),
    ClientListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId,
      signal: input.signal,
    },
  );
}

export function createClient(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly request: ClientCreateRequest;
  readonly idempotencyKey: string;
}): Promise<ClientSummary> {
  return requestApi(
    companyClientsPath(input.companyId),
    ClientSummarySchema,
    {
      method: 'POST',
      body: ClientCreateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function updateClient(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly clientId: string;
  readonly request: ClientUpdateRequest;
  readonly idempotencyKey: string;
}): Promise<ClientSummary> {
  return requestApi(
    companyClientPath(input.companyId, input.clientId),
    ClientSummarySchema,
    {
      method: 'PATCH',
      body: ClientUpdateRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}

export function deleteOrArchiveClient(input: {
  readonly uid: string;
  readonly companyId: number;
  readonly clientId: string;
  readonly request: ClientDeleteRequest;
  readonly idempotencyKey: string;
}): Promise<ClientDeleteResult> {
  return requestApi(
    companyClientPath(input.companyId, input.clientId),
    ClientDeleteResultSchema,
    {
      method: 'DELETE',
      body: ClientDeleteRequestSchema.parse(input.request),
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId,
    },
  );
}
