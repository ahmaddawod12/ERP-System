import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { WorkerSummary } from '@smart-job/api-contracts';

import { tenantQueryKey } from '../../../lib/query/client';
import { fetchWorkersPage } from './workers-api';

export function useWorkersInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly enabled?: boolean;
}) {
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;
  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'workers'),
    queryFn: ({ pageParam }) => fetchWorkersPage({
      uid,
      companyId,
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

  const workers = useMemo(() => {
    const byMemberNo = new Map<number, WorkerSummary>();
    for (const page of query.data?.pages ?? []) {
      for (const worker of page.items) byMemberNo.set(worker.memberNo, worker);
    }
    return [...byMemberNo.values()];
  }, [query.data?.pages]);

  return { query, workers };
}
