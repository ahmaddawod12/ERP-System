import type { SupportCategory } from '@smart-job/api-contracts';

export const SUPPORT_PAGE_SIZE = 50;

export function buildSupportConversationListPath(input: {
  readonly status?: 'open' | 'closed';
  readonly category?: SupportCategory;
  readonly afterCursor?: string | null;
}): string {
  const searchParams = new URLSearchParams();
  searchParams.set('pageSize', String(SUPPORT_PAGE_SIZE));
  if (input.status) searchParams.set('status', input.status);
  if (input.category) searchParams.set('category', input.category);
  if (input.afterCursor) searchParams.set('afterCursor', input.afterCursor);
  return `/api/v1/support/conversations?${searchParams.toString()}`;
}

export function buildSupportThreadPath(
  conversationId: string,
  afterCursor: string | null,
): string {
  const searchParams = new URLSearchParams();
  searchParams.set('pageSize', String(SUPPORT_PAGE_SIZE));
  if (afterCursor) searchParams.set('afterCursor', afterCursor);
  return `/api/v1/support/conversations/${encodeURIComponent(conversationId)}/messages?${searchParams.toString()}`;
}
