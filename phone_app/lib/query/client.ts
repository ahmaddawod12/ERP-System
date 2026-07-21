import { QueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../api/client';

function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 2) {
    return false;
  }
  if (!(error instanceof ApiClientError)) {
    return false;
  }
  return error.retryable;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1_000,
      retry: shouldRetry,
      refetchOnMount: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});

export function tenantQueryKey(
  uid: string,
  companyId: number,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return ['tenant', uid, companyId, ...parts] as const;
}

export function invalidateTenantQueries(
  uid: string,
  companyId: number,
  ...parts: readonly unknown[]
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: tenantQueryKey(uid, companyId, ...parts),
  });
}

export function cancelTenantQueries(uid: string, companyId: number): Promise<void> {
  return queryClient.cancelQueries({ queryKey: tenantQueryKey(uid, companyId) });
}

export function removeTenantQueries(uid: string, companyId: number): void {
  queryClient.removeQueries({ queryKey: tenantQueryKey(uid, companyId) });
}
