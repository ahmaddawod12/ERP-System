import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  InventoryAdjustmentRequest,
  InventoryPartArchiveRequest,
  InventoryPartCreateRequest,
  InventoryPartUpdateRequest,
  InventoryPickRequest,
  InventoryTransferRequest,
} from '@smart-job/api-contracts';

import { tenantQueryKey } from '../../../lib/query/client';
import {
  adjustInventoryStock,
  archiveInventoryPart,
  createInventoryPart,
  pickInventoryStock,
  transferInventoryStock,
  updateInventoryPart,
} from './inventory-api';

export function useInventoryMutations(input: {
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

  async function invalidateInventory(): Promise<void> {
    if (!uid || companyId <= 0) return;
    await queryClient.invalidateQueries({
      queryKey: tenantQueryKey(uid, companyId, 'inventory'),
    });
  }

  const createMutation = useMutation({
    mutationFn: (request: {
      readonly body: InventoryPartCreateRequest;
      readonly idempotencyKey: string;
    }) => createInventoryPart({
      ...requireScope(),
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  const updateMutation = useMutation({
    mutationFn: (request: {
      readonly partId: string;
      readonly body: InventoryPartUpdateRequest;
      readonly idempotencyKey: string;
    }) => updateInventoryPart({
      ...requireScope(),
      partId: request.partId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  const archiveMutation = useMutation({
    mutationFn: (request: {
      readonly partId: string;
      readonly body: InventoryPartArchiveRequest;
      readonly idempotencyKey: string;
    }) => archiveInventoryPart({
      ...requireScope(),
      partId: request.partId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  const adjustMutation = useMutation({
    mutationFn: (request: {
      readonly scope: 'company' | 'member';
      readonly partId: string;
      readonly body: InventoryAdjustmentRequest;
      readonly idempotencyKey: string;
    }) => adjustInventoryStock({
      ...requireScope(),
      scope: request.scope,
      partId: request.partId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  const transferMutation = useMutation({
    mutationFn: (request: {
      readonly body: InventoryTransferRequest;
      readonly idempotencyKey: string;
    }) => transferInventoryStock({
      ...requireScope(),
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  const pickMutation = useMutation({
    mutationFn: (request: {
      readonly body: InventoryPickRequest;
      readonly idempotencyKey: string;
    }) => pickInventoryStock({
      ...requireScope(),
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: invalidateInventory,
  });

  return {
    createMutation,
    updateMutation,
    archiveMutation,
    adjustMutation,
    transferMutation,
    pickMutation,
  };
}
