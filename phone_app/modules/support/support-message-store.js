import {
  db,
  FieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
} from '../../firebase';

function extractLegacyMessagesFromConversation(conversationData) {
  const messages = [];
  let index = 1;

  while (conversationData[`message${index}`]) {
    const legacyMessage = conversationData[`message${index}`];
    messages.push({
      id: `legacy-message-${index}`,
      senderUid: legacyMessage.senderUid,
      text: legacyMessage.text,
      index,
      createdAt: null,
      source: 'legacy',
    });
    index += 1;
  }

  return messages;
}

export async function loadConversationThread(conversationId) {
  const conversationRef = doc(db, 'conversations', conversationId);
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');

  const [conversationSnap, messagesSnap] = await Promise.all([
    getDoc(conversationRef),
    getDocs(query(messagesRef, orderBy('createdAt', 'asc'))),
  ]);

  const conversationExists = typeof conversationSnap.exists === 'function'
    ? conversationSnap.exists()
    : conversationSnap.exists;

  const legacyMessages = conversationExists
    ? extractLegacyMessagesFromConversation(conversationSnap.data())
    : [];

  const subcollectionMessages = messagesSnap.docs.map((messageSnap) => {
    const data = messageSnap.data() || {};
    return {
      id: messageSnap.id,
      senderUid: data.senderUid,
      text: data.text,
      createdAt: data.createdAt?.toDate?.() || null,
      source: 'subcollection',
    };
  });

  return [...legacyMessages, ...subcollectionMessages];
}

export async function appendConversationMessage({
  conversationId,
  senderUid,
  text,
  unreadForDevDelta = 0,
  unreadForUserDelta = 0,
  unreadForDevValue = null,
  unreadForUserValue = null,
  status = 'open',
}) {
  const conversationRef = doc(db, 'conversations', conversationId);
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');

  await runTransaction(db, async (transaction) => {
    const conversationSnap = await transaction.get(conversationRef);
    const conversationExists = typeof conversationSnap.exists === 'function'
      ? conversationSnap.exists()
      : conversationSnap.exists;
    if (!conversationExists) {
      throw new Error('Conversation not found');
    }

    const conversationData = conversationSnap.data() || {};
    const messageRef = doc(messagesRef);

    transaction.set(messageRef, {
      senderUid,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.update(conversationRef, {
      status,
      lastMessage: text,
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadForDev: unreadForDevValue ?? (
        Math.max(0, Number(conversationData.unreadForDev || 0)) + unreadForDevDelta
      ),
      unreadForUser: unreadForUserValue ?? (
        Math.max(0, Number(conversationData.unreadForUser || 0)) + unreadForUserDelta
      ),
    });
  });
}
