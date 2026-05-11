// @ts-nocheck
import { getSupportConversationThread } from './support-api';

interface SubcollectionMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAt: Date | null;
  source: 'sql';
}

export type ConversationMessage = SubcollectionMessage;

export async function loadConversationThread(conversationId: string): Promise<ConversationMessage[]> {
  const messages = await getSupportConversationThread(conversationId);
  return messages.map((message: any) => ({
    id: message.id,
    senderUid: message.senderUid,
    text: message.text,
    createdAt: message.createdAt || null,
    source: 'sql',
  }));
}

