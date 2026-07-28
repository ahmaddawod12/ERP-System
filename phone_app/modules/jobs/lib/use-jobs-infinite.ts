import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { tenantQueryKey } from '../../../lib/query/client';
import { fetchJobsPage } from './jobs-api';
import {
  mergeJobSummaryPages,
  normalizeJobListFilters,
  type JobListFilters,
} from './job-list-model';

export function useJobsInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly filters: JobListFilters;
  readonly enabled?: boolean;
}) {
  const filters = useMemo(
    () => normalizeJobListFilters(input.filters),
    [input.filters],
  );
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'jobs', filters),
    queryFn: ({ pageParam, signal }) => fetchJobsPage({
      uid,
      companyId,
      filters,
      afterCursor: pageParam,
      signal,
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
    refetchOnMount: true,
    enabled,
  });

  const jobs = useMemo(
    () => mergeJobSummaryPages(query.data?.pages),
    [query.data?.pages],
  );

  return { query, jobs, filters };
}
