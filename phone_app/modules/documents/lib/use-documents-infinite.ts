import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { tenantQueryKey } from '../../../lib/query/client';
import {
  mergeDocumentSummaryPages,
  normalizeDocumentListFilters,
  type DocumentListFilters,
} from './document-history-model';
import { fetchDocumentsPage } from './documents-api';

export function useDocumentsInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly filters: DocumentListFilters;
  readonly enabled?: boolean;
}) {
  const filters = useMemo(
    () => normalizeDocumentListFilters(input.filters),
    [input.filters],
  );
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'documents', filters),
    queryFn: ({ pageParam, signal }) => fetchDocumentsPage({
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
    enabled,
  });

  const documents = useMemo(
    () => mergeDocumentSummaryPages(query.data?.pages),
    [query.data?.pages],
  );

  return { query, documents, filters };
}
