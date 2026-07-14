import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { tenantQueryKey } from '../../../lib/query/client';
import { fetchInventoryPage } from './inventory-api';
import {
  mergeInventoryPartPages,
  normalizeInventoryListFilters,
  type InventoryListFilters,
  type InventoryReadScope,
} from './inventory-list-model';

export function useInventoryInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly scope: InventoryReadScope;
  readonly filters: InventoryListFilters;
  readonly enabled?: boolean;
}) {
  const filters = useMemo(
    () => normalizeInventoryListFilters(input.filters),
    [input.filters],
  );
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'inventory', input.scope, filters),
    queryFn: ({ pageParam }) => fetchInventoryPage({
      uid,
      companyId,
      scope: input.scope,
      filters,
      afterCursor: pageParam,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[0] === 'tenant'
        && previousKey[1] === uid
        && previousKey[2] === companyId
        && previousKey[4] === input.scope
        ? previousData
        : undefined;
    },
    enabled,
  });

  const parts = useMemo(
    () => mergeInventoryPartPages(query.data?.pages),
    [query.data?.pages],
  );

  return { query, parts, filters };
}
