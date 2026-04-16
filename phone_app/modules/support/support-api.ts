import { functions, httpsCallable } from '../../firebase';

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
