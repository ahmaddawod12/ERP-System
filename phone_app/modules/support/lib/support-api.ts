import {
  SupportConversationClosedResultSchema,
  SupportConversationCreateRequestSchema,
  SupportConversationListPageSchema,
  SupportConversationReadResultSchema,
  SupportConversationSummarySchema,
  SupportConversationThreadSchema,
  SupportMessageCreateRequestSchema,
  SupportMessageSchema,
  type CursorPage,
  type SupportCategory,
  type SupportConversationSummary,
} from '@smart-job/api-contracts';

import { requestApi } from '../../../lib/api/client';
import {
  buildSupportConversationListPath,
  buildSupportThreadPath,
} from './support-query-model';

interface SupportRequestIdentity {
  readonly uid: string;
  readonly companyId?: number | null;
  readonly signal?: AbortSignal;
}

export function fetchSupportConversationsPage(input: SupportRequestIdentity & {
  readonly status?: 'open' | 'closed';
  readonly category?: SupportCategory;
  readonly afterCursor?: string | null;
}): Promise<CursorPage<SupportConversationSummary>> {
  return requestApi(
    buildSupportConversationListPath(input),
    SupportConversationListPageSchema,
    {
      uid: input.uid,
      companyId: input.companyId ?? undefined,
      signal: input.signal,
    },
  );
}

export function fetchSupportThreadPage(input: SupportRequestIdentity & {
  readonly conversationId: string;
  readonly afterCursor?: string | null;
}) {
  return requestApi(
    buildSupportThreadPath(input.conversationId, input.afterCursor ?? null),
    SupportConversationThreadSchema,
    {
      uid: input.uid,
      companyId: input.companyId ?? undefined,
      signal: input.signal,
    },
  );
}

export function createSupportConversation(input: SupportRequestIdentity & {
  readonly category: SupportCategory;
  readonly idempotencyKey: string;
}) {
  const body = SupportConversationCreateRequestSchema.parse({
    companyId: input.companyId ?? undefined,
    category: input.category,
  });
  return requestApi(
    '/api/v1/support/conversations',
    SupportConversationSummarySchema,
    {
      method: 'POST',
      body,
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId ?? undefined,
    },
  );
}

export function appendSupportMessage(input: SupportRequestIdentity & {
  readonly conversationId: string;
  readonly text: string;
  readonly idempotencyKey: string;
}) {
  const body = SupportMessageCreateRequestSchema.parse({ text: input.text });
  return requestApi(
    `/api/v1/support/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    SupportMessageSchema,
    {
      method: 'POST',
      body,
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId ?? undefined,
    },
  );
}

export function markSupportConversationRead(input: SupportRequestIdentity & {
  readonly conversationId: string;
  readonly idempotencyKey: string;
}) {
  return requestApi(
    `/api/v1/support/conversations/${encodeURIComponent(input.conversationId)}/read`,
    SupportConversationReadResultSchema,
    {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId ?? undefined,
    },
  );
}

export function closeSupportConversation(input: SupportRequestIdentity & {
  readonly conversationId: string;
  readonly idempotencyKey: string;
}) {
  return requestApi(
    `/api/v1/support/conversations/${encodeURIComponent(input.conversationId)}/close`,
    SupportConversationClosedResultSchema,
    {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      uid: input.uid,
      companyId: input.companyId ?? undefined,
    },
  );
}
