import { getSupportConversationThread } from './support-api';

interface RawMessage {
  id?: string;
  senderUid?: string;
  text?: string;
  createdAt?: Date | null;
}

export interface ConversationMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAt: Date | null;
  source: 'sql';
}

export async function loadConversationThread(conversationId: string): Promise<ConversationMessage[]> {
  const messages = await getSupportConversationThread(conversationId);
  return messages.map((message: RawMessage) => ({
    id: message.id || '',
    senderUid: message.senderUid || '',
    text: message.text || '',
    createdAt: message.createdAt || null,
    source: 'sql' as const,
  }));
}

