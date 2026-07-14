import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ClientCreateRequest,
  ClientDeleteRequest,
  ClientUpdateRequest,
} from '@smart-job/api-contracts';

import { tenantQueryKey } from '../../../lib/query/client';
import {
  createClient,
  deleteOrArchiveClient,
  updateClient,
} from './clients-api';

export function useClientMutations(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
}) {
  const queryClient = useQueryClient();
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;

  function requireScope(): { uid: string; companyId: number } {
    if (!uid || !Number.isSafeInteger(companyId) || companyId <= 0) {
      throw new Error('An authenticated user and selected company are required');
    }
    return { uid, companyId };
  }

  async function invalidateClients(): Promise<void> {
    if (!uid || companyId <= 0) return;
    await queryClient.invalidateQueries({
      queryKey: tenantQueryKey(uid, companyId, 'clients'),
    });
  }

  const createMutation = useMutation({
    mutationFn: (request: {
      readonly body: ClientCreateRequest;
      readonly idempotencyKey: string;
    }) => createClient({
      ...requireScope(),
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateClients,
  });

  const updateMutation = useMutation({
    mutationFn: (request: {
      readonly clientId: string;
      readonly body: ClientUpdateRequest;
      readonly idempotencyKey: string;
    }) => updateClient({
      ...requireScope(),
      clientId: request.clientId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateClients,
  });

  const removeMutation = useMutation({
    mutationFn: (request: {
      readonly clientId: string;
      readonly body: ClientDeleteRequest;
      readonly idempotencyKey: string;
    }) => deleteOrArchiveClient({
      ...requireScope(),
      clientId: request.clientId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateClients,
  });

  return { createMutation, updateMutation, removeMutation };
}
