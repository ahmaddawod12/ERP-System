import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { tenantQueryKey } from '../../../lib/query/client';
import {
  mergeClientSummaryPages,
  normalizeClientListFilters,
  type ClientListFilters,
} from './client-list-model';
import { fetchClientsPage } from './clients-api';

export function useClientsInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly filters: ClientListFilters;
  readonly enabled?: boolean;
}) {
  const filters = useMemo(
    () => normalizeClientListFilters(input.filters),
    [input.filters],
  );
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'clients', filters),
    queryFn: ({ pageParam }) => fetchClientsPage({
      uid,
      companyId,
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
        ? previousData
        : undefined;
    },
    enabled,
  });

  const clients = useMemo(
    () => mergeClientSummaryPages(query.data?.pages),
    [query.data?.pages],
  );

  return { query, clients, filters };
}
