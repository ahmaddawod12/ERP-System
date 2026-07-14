import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DocumentDeleteRequest } from '@smart-job/api-contracts';

import { tenantQueryKey } from '../../../lib/query/client';
import { deleteDocument } from './documents-api';

export function useDocumentMutations(input: {
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

  const deleteMutation = useMutation({
    mutationFn: (request: {
      readonly documentId: string;
      readonly body: DocumentDeleteRequest;
      readonly idempotencyKey: string;
    }) => deleteDocument({
      ...requireScope(),
      documentId: request.documentId,
      request: request.body,
      idempotencyKey: request.idempotencyKey,
    }),
    onSuccess: async () => {
      if (!uid || companyId <= 0) return;
      await queryClient.invalidateQueries({
        queryKey: tenantQueryKey(uid, companyId, 'documents'),
      });
    },
  });

  return { deleteMutation };
}
