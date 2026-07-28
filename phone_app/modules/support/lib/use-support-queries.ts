import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type {
  SupportCategory,
  SupportConversationThread,
  SupportMessage,
} from '@smart-job/api-contracts';

import { fetchViewerProfile } from '../../../lib/api/client';
import { queryClient, tenantQueryKey } from '../../../lib/query/client';
import {
  fetchSupportConversationsPage,
  fetchSupportThreadPage,
} from './support-api';
import {
  mergeSupportConversationPages,
  mergeSupportMessagePages,
} from './support-message-store';

function sameTenant(previousKey: readonly unknown[] | undefined, uid: string, companyId: number) {
  return previousKey?.[0] === 'tenant'
    && previousKey[1] === uid
    && previousKey[2] === companyId;
}

export function useSupportConversationsInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly status?: 'open' | 'closed';
  readonly category?: SupportCategory;
  readonly enabled?: boolean;
}) {
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const status = input.status ?? 'all';
  const category = input.category ?? 'all';
  const enabled = (input.enabled ?? true) && uid.length > 0;
  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(
      uid,
      companyId,
      'support',
      'conversations',
      status,
      category,
    ),
    queryFn: ({ pageParam, signal }) => fetchSupportConversationsPage({
      uid,
      companyId: companyId > 0 ? companyId : null,
      status: input.status,
      category: input.category,
      afterCursor: pageParam,
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return sameTenant(previousKey, uid, companyId)
        && previousKey?.[5] === status
        && previousKey[6] === category
        ? previousData
        : undefined;
    },
    refetchOnMount: true,
    enabled,
  });
  const conversations = useMemo(
    () => mergeSupportConversationPages(query.data?.pages),
    [query.data?.pages],
  );
  return { query, conversations };
}

export function useSupportThreadInfinite(input: {
  readonly uid: string | null;
  readonly companyId: number | null;
  readonly conversationId: string | null;
  readonly enabled?: boolean;
}) {
  const uid = input.uid ?? '';
  const companyId = input.companyId ?? 0;
  const conversationId = input.conversationId ?? '';
  const enabled = (input.enabled ?? true) && uid.length > 0 && conversationId.length > 0;
  const query = useInfiniteQuery({
    queryKey: tenantQueryKey(uid, companyId, 'support', 'thread', conversationId),
    queryFn: ({ pageParam, signal }) => fetchSupportThreadPage({
      uid,
      companyId: companyId > 0 ? companyId : null,
      conversationId,
      afterCursor: pageParam,
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return sameTenant(previousKey, uid, companyId)
        && previousKey?.[5] === conversationId
        ? previousData
        : undefined;
    },
    refetchOnMount: true,
    enabled,
  });
  const messages = useMemo(
    () => mergeSupportMessagePages(query.data?.pages),
    [query.data?.pages],
  );
  const conversation = query.data?.pages[0]?.conversation ?? null;
  return { query, messages, conversation };
}

export function appendSupportMessageToThreadCache(input: {
  readonly uid: string;
  readonly companyId: number | null;
  readonly conversationId: string;
  readonly message: SupportMessage;
}): boolean {
  const queryKey = tenantQueryKey(
    input.uid,
    input.companyId ?? 0,
    'support',
    'thread',
    input.conversationId,
  );
  const updated = queryClient.setQueryData<InfiniteData<SupportConversationThread>>(
    queryKey,
    (current) => {
      if (!current || current.pages.length === 0) return current;
      const pages = [...current.pages];
      const lastIndex = pages.length - 1;
      const lastPage = pages[lastIndex];
      if (!lastPage) return current;
      pages[lastIndex] = {
        ...lastPage,
        messages: [
          ...lastPage.messages.filter((message) => message.id !== input.message.id),
          input.message,
        ],
      };
      return { ...current, pages };
    },
  );
  return updated !== undefined;
}

export function useTrustedViewerProfile(uid: string | null, companyId: number | null) {
  const normalizedUid = uid ?? '';
  const scopeCompanyId = companyId ?? 0;
  return useQuery({
    queryKey: tenantQueryKey(normalizedUid, scopeCompanyId, 'viewer-profile'),
    queryFn: ({ signal }) => fetchViewerProfile(normalizedUid, companyId, signal),
    placeholderData: (previousData, previousQuery) => (
      sameTenant(previousQuery?.queryKey, normalizedUid, scopeCompanyId)
        ? previousData
        : undefined
    ),
    refetchOnMount: true,
    enabled: normalizedUid.length > 0,
  });
}
