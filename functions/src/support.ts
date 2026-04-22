/**
 * Support conversation domain module.
 */

const {
  onCall,
  HttpsError,
  admin,
  logger,
  getUserProfileOrThrow,
  isRateLimited,
} = require('./shared');

const SUPPORT_CONVERSATION_LIMIT = { maxRequests: 3, windowMs: 60_000 };
const SUPPORT_MESSAGE_LIMIT = { maxRequests: 20, windowMs: 60_000 };

async function assertSupportRateLimit(key, options, message) {
  if (await isRateLimited(key, options)) {
    throw new HttpsError('resource-exhausted', message);
  }
}

function requireSupportText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length < 1) {
    throw new HttpsError('invalid-argument', 'text is required');
  }
  if (text.length > 4000) {
    throw new HttpsError('invalid-argument', 'text is too long');
  }
  return text;
}

function requireConversationId(value) {
  const conversationId = typeof value === 'string' ? value.trim() : '';
  if (!conversationId || conversationId.length > 128) {
    throw new HttpsError('invalid-argument', 'conversationId is invalid');
  }
  return conversationId;
}

function normalizeCategory(value) {
  const category = typeof value === 'string' ? value.trim() : '';
  if (!category) return 'general';
  return category.slice(0, 64);
}

function isDevProfile(profile) {
  return String(profile?.role || '').trim().toLowerCase() === 'dev';
}

export const createSupportConversationV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  await assertSupportRateLimit(
    `support:create:${uid}`,
    SUPPORT_CONVERSATION_LIMIT,
    'Too many support conversations created. Please wait and try again.',
  );
  const profile: any = await getUserProfileOrThrow(uid);
  const category = normalizeCategory(request.data?.category);
  const userName = String(profile.name || profile.email || uid).trim();
  const conversationsRef = admin.firestore().collection('conversations');
  const conversationRef = conversationsRef.doc();

  await conversationRef.set({
    userId: uid,
    userName,
    status: 'open',
    category,
    lastMessage: '',
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    unreadForUser: 0,
    unreadForDev: 0,
  });

  logger.info('createSupportConversationV1: conversation created', { uid, conversationId: conversationRef.id, category });
  return { success: true, conversationId: conversationRef.id };
});

export const appendSupportMessageV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const conversationId = requireConversationId(request.data?.conversationId);
  await assertSupportRateLimit(
    `support:message:${uid}:${conversationId}`,
    SUPPORT_MESSAGE_LIMIT,
    'Too many support messages sent. Please wait and try again.',
  );
  const text = requireSupportText(request.data?.text);
  const profile: any = await getUserProfileOrThrow(uid);
  const devSender = isDevProfile(profile);
  const db = admin.firestore();
  const conversationRef = db.collection('conversations').doc(conversationId);
  const messagesRef = conversationRef.collection('messages');

  await db.runTransaction(async (tx) => {
    const conversationSnap = await tx.get(conversationRef);
    if (!conversationSnap.exists) {
      throw new HttpsError('not-found', 'Conversation not found');
    }

    const conversationData = conversationSnap.data() || {};
    if (!devSender && conversationData.userId !== uid) {
      throw new HttpsError('permission-denied', 'You can only message your own conversation');
    }
    if (conversationData.status === 'closed') {
      throw new HttpsError(
        'failed-precondition',
        'Conversation is closed. Start a new conversation to continue.'
      );
    }

    const messageRef = messagesRef.doc();
    tx.set(messageRef, {
      senderUid: uid,
      senderRole: devSender ? 'dev' : 'user',
      senderProfileRole: String(profile.role || ''),
      text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(conversationRef, {
      lastMessage: text,
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      unreadForDev: devSender ? 0 : Math.max(0, Number(conversationData.unreadForDev || 0)) + 1,
      unreadForUser: devSender ? Math.max(0, Number(conversationData.unreadForUser || 0)) + 1 : 0,
    });
  });

  logger.info('appendSupportMessageV1: message appended', {
    uid,
    conversationId,
    senderRole: profile.role,
  });
  return { success: true, conversationId };
});

export const markSupportConversationReadV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const conversationId = requireConversationId(request.data?.conversationId);
  const profile: any = await getUserProfileOrThrow(uid);
  const devReader = isDevProfile(profile);
  const conversationRef = admin.firestore().collection('conversations').doc(conversationId);
  const snap = await conversationRef.get();

  if (!snap.exists) {
    throw new HttpsError('not-found', 'Conversation not found');
  }

  const conversationData = snap.data() || {};
  if (!devReader && conversationData.userId !== uid) {
    throw new HttpsError('permission-denied', 'You can only read your own conversation');
  }

  await conversationRef.update(devReader ? { unreadForDev: 0 } : { unreadForUser: 0 });
  return { success: true, conversationId };
});

export const closeSupportConversationV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const conversationId = requireConversationId(request.data?.conversationId);
  const profile: any = await getUserProfileOrThrow(uid);
  if (!isDevProfile(profile)) {
    throw new HttpsError('permission-denied', 'Only dev admins can close support conversations');
  }

  await admin.firestore().collection('conversations').doc(conversationId).update({
    status: 'closed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info('closeSupportConversationV1: conversation closed', { uid, conversationId });
  return { success: true, conversationId };
});
