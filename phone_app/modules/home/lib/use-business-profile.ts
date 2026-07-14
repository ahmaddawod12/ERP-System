import { useQuery } from '@tanstack/react-query';

import { fetchBusinessProfile } from '../../../lib/api/client';
import { tenantQueryKey } from '../../../lib/query/client';

export function useBusinessProfile(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly enabled?: boolean;
}) {
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const enabled = (input.enabled ?? true) && uid.length > 0 && companyId > 0;

  return useQuery({
    queryKey: tenantQueryKey(uid, companyId, 'business-profile'),
    queryFn: () => fetchBusinessProfile(uid, companyId),
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
