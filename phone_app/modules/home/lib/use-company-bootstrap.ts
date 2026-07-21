import { useQuery } from '@tanstack/react-query';

import { fetchCompanyBootstrap } from '../../../lib/api/client';
import { tenantQueryKey } from '../../../lib/query/client';

export function useCompanyBootstrap(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly enabled?: boolean;
}) {
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  return useQuery({
    queryKey: tenantQueryKey(uid, companyId, 'bootstrap'),
    queryFn: ({ signal }) => fetchCompanyBootstrap(uid, companyId, signal),
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
}
