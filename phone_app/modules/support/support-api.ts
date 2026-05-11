import { functions, httpsCallable } from '../../firebase';

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function normalizeConversation(item: any) {
  return {
    ...item,
    lastMessageAt: asDate(item?.lastMessageAt) || new Date(),
    createdAt: asDate(item?.createdAt) || new Date(),
    updatedAt: asDate(item?.updatedAt) || null,
    unreadForUser: Number(item?.unreadForUser || 0),
    unreadForDev: Number(item?.unreadForDev || 0),
  };
}

function normalizeMessage(item: any) {
  return {
    ...item,
    createdAt: asDate(item?.createdAt),
  };
}

export async function createSupportConversation(category?: string): Promise<string> {
  const callable = httpsCallable(functions, 'createSupportConversationV1');
  const result = await callable({ category: category || 'general' });
  return ((result.data as { conversationId?: string } | null | undefined)?.conversationId) || '';
}

export async function appendSupportMessage(conversationId: string, text: string): Promise<void> {
  const callable = httpsCallable(functions, 'appendSupportMessageV1');
  await callable({ conversationId, text });
}

export async function markSupportConversationRead(conversationId: string): Promise<void> {
  const callable = httpsCallable(functions, 'markSupportConversationReadV1');
  await callable({ conversationId });
}

export async function closeSupportConversation(conversationId: string): Promise<void> {
  const callable = httpsCallable(functions, 'closeSupportConversationV1');
  await callable({ conversationId });
}

export async function listSupportConversations(status = 'open', limit?: number): Promise<any[]> {
  const callable = httpsCallable(functions, 'listSupportConversationsV1');
  const result = await callable({ status, limit });
  const conversations = ((result.data as { conversations?: any[] } | null | undefined)?.conversations) || [];
  return conversations.map(normalizeConversation);
}

export async function getSupportConversationThread(conversationId: string): Promise<any[]> {
  const callable = httpsCallable(functions, 'getSupportConversationThreadV1');
  const result = await callable({ conversationId });
  const messages = ((result.data as { messages?: any[] } | null | undefined)?.messages) || [];
  return messages.map(normalizeMessage);
}
