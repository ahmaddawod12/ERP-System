import type {
  CursorPage,
  SupportConversationSummary,
  SupportConversationThread,
  SupportMessage,
} from '@smart-job/api-contracts';

function mergeById<T extends { readonly id: string }>(
  pages: readonly (readonly T[])[] | undefined,
): T[] {
  const items = new Map<string, T>();
  for (const page of pages ?? []) {
    for (const item of page) items.set(item.id, item);
  }
  return [...items.values()];
}

export function mergeSupportConversationPages(
  pages: readonly CursorPage<SupportConversationSummary>[] | undefined,
): SupportConversationSummary[] {
  return mergeById(pages?.map((page) => page.items));
}

export function mergeSupportMessagePages(
  pages: readonly SupportConversationThread[] | undefined,
): SupportMessage[] {
  return mergeById(pages?.map((page) => page.messages)).sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ));
}

export function supportDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type ConversationMessage = SupportMessage;
