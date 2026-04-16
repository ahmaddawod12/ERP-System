// @ts-nocheck
import {
  db,
  collection,
  getDocs,
  orderBy,
  query,
} from '../../firebase';

interface SubcollectionMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAt: Date | null;
  source: 'subcollection';
}

export type ConversationMessage = SubcollectionMessage;

export async function loadConversationThread(conversationId: string): Promise<ConversationMessage[]> {
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');

  const messagesSnap = await getDocs(query(messagesRef, orderBy('createdAt', 'asc')));

  const subcollectionMessages: SubcollectionMessage[] = messagesSnap.docs.map((messageSnap: any) => {
    const data = messageSnap.data() || {};
    return {
      id: messageSnap.id,
      senderUid: data.senderUid,
      text: data.text,
      createdAt: data.createdAt?.toDate?.() || null,
      source: 'subcollection',
    };
  });

  return subcollectionMessages;
}

