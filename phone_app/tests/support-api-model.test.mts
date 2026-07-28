import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SupportConversationListPageSchema,
  SupportConversationThreadSchema,
} from '@smart-job/api-contracts';

import { StableSupportActionKeys } from '../modules/support/lib/support-action-keys.ts';
import {
  mergeSupportConversationPages,
  mergeSupportMessagePages,
  supportDate,
} from '../modules/support/lib/support-message-store.ts';
import {
  SUPPORT_PAGE_SIZE,
  buildSupportConversationListPath,
  buildSupportThreadPath,
} from '../modules/support/lib/support-query-model.ts';

const FIRST_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_USER_ID = '33333333-3333-4333-8333-333333333333';
const FIRST_MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_MESSAGE_ID = '55555555-5555-4555-8555-555555555555';

function conversation(id: string, lastMessage: string) {
  return {
    id,
    userId: FIRST_USER_ID,
    userName: 'Support User',
    companyId: 17,
    category: 'support' as const,
    status: 'open' as const,
    lastMessage,
    lastMessageAt: '2026-07-13T10:00:00.000Z',
    unreadForUser: 0,
    unreadForDev: 1,
    createdAt: '2026-07-13T09:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
  };
}

function message(id: string, text: string, createdAt: string) {
  return {
    id,
    conversationId: FIRST_CONVERSATION_ID,
    senderUid: FIRST_USER_ID,
    senderRole: 'user' as const,
    senderName: 'Support User',
    text,
    createdAt,
  };
}

test('support list and thread paths always use bounded pages and opaque cursors', () => {
  assert.equal(SUPPORT_PAGE_SIZE, 50);
  const listPath = buildSupportConversationListPath({
    status: 'closed',
    category: 'bug',
    afterCursor: 'opaque+/cursor=',
  });
  assert.match(listPath, /^\/api\/v1\/support\/conversations\?/);
  assert.match(listPath, /pageSize=50/);
  assert.match(listPath, /status=closed/);
  assert.match(listPath, /category=bug/);
  assert.match(listPath, /afterCursor=opaque%2B%2Fcursor%3D/);

  const threadPath = buildSupportThreadPath(FIRST_CONVERSATION_ID, 'next/cursor');
  assert.match(threadPath, new RegExp(`${FIRST_CONVERSATION_ID}/messages\\?`));
  assert.match(threadPath, /pageSize=50/);
  assert.match(threadPath, /afterCursor=next%2Fcursor/);
});

test('support page merging is stable and deduplicates overlapping cursors', () => {
  const firstConversation = conversation(FIRST_CONVERSATION_ID, 'first');
  const updatedConversation = conversation(FIRST_CONVERSATION_ID, 'updated');
  const secondConversation = conversation(SECOND_CONVERSATION_ID, 'second');
  const pages = [
    SupportConversationListPageSchema.parse({
      items: [firstConversation],
      nextCursor: 'cursor-one',
    }),
    SupportConversationListPageSchema.parse({
      items: [updatedConversation, secondConversation],
      nextCursor: null,
    }),
  ];
  assert.deepEqual(
    mergeSupportConversationPages(pages).map((item) => [item.id, item.lastMessage]),
    [
      [FIRST_CONVERSATION_ID, 'updated'],
      [SECOND_CONVERSATION_ID, 'second'],
    ],
  );

  const firstMessage = message(FIRST_MESSAGE_ID, 'first', '2026-07-13T10:00:00.000Z');
  const secondMessage = message(SECOND_MESSAGE_ID, 'second', '2026-07-13T10:01:00.000Z');
  const threadPages = [
    SupportConversationThreadSchema.parse({
      conversation: firstConversation,
      messages: [firstMessage],
      nextCursor: 'cursor-two',
    }),
    SupportConversationThreadSchema.parse({
      conversation: updatedConversation,
      messages: [firstMessage, secondMessage],
      nextCursor: null,
    }),
  ];
  assert.deepEqual(
    mergeSupportMessagePages(threadPages).map((item) => item.id),
    [FIRST_MESSAGE_ID, SECOND_MESSAGE_ID],
  );
  assert.equal(supportDate(secondMessage.createdAt)?.toISOString(), secondMessage.createdAt);
  assert.equal(supportDate('not-a-date'), null);
});

test('pending support actions reuse one idempotency key until completion', () => {
  let sequence = 0;
  const keys = new StableSupportActionKeys(() => `stable-key-${++sequence}`);
  const first = keys.keyFor('message:one', 'conversation:hello');
  assert.equal(keys.keyFor('message:one', 'conversation:hello'), first);
  assert.notEqual(keys.keyFor('message:one', 'conversation:changed'), first);
  const current = keys.keyFor('message:one', 'conversation:changed');
  keys.complete('message:one', current);
  assert.notEqual(keys.keyFor('message:one', 'conversation:changed'), current);
  const beforeReset = keys.keyFor('read:one', 'conversation');
  keys.reset();
  assert.notEqual(keys.keyFor('read:one', 'conversation'), beforeReset);
});

test('support screens use authenticated scoped API queries without Firebase or collection drains', async () => {
  const [api, hooks, store, userScreen, devScreen] = await Promise.all([
    readFile(new URL('../modules/support/lib/support-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/support/lib/use-support-queries.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/support/lib/support-message-store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/support/screens/SupportChat.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../modules/support/screens/DevInbox.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(api, /requestApi/);
  assert.match(api, /SupportConversationListPageSchema/);
  assert.match(api, /SupportConversationThreadSchema/);
  assert.match(api, /SupportMessageSchema/);
  assert.match(api, /idempotencyKey/);
  assert.doesNotMatch(api, /firebase|httpsCallable|senderUid|ownerUid|userId\s*:/i);

  assert.match(hooks, /useInfiniteQuery/);
  assert.match(hooks, /tenantQueryKey/);
  assert.match(hooks, /previousKey\[1\] === uid/);
  assert.match(hooks, /previousKey\[2\] === companyId/);
  assert.doesNotMatch(hooks, /while\s*\(|fetchAll|drain/i);
  assert.doesNotMatch(store, /firebase|MMKV|storage|loadConversationThread/i);

  for (const screen of [userScreen, devScreen]) {
    assert.match(screen, /useSession/);
    assert.match(screen, /useTenant/);
    assert.match(screen, /fetchNextPage/);
    assert.match(screen, /StableSupportActionKeys/);
    assert.doesNotMatch(screen, /httpsCallable|auth\.currentUser|from ['"].*firebase|console\.|MMKV|storage\./i);
  }
  assert.match(devScreen, /viewerQuery\.data\?\.systemRole === 'dev'/);
  assert.match(devScreen, /workspace\?\.role === 'dev'/);
  assert.match(devScreen, /runLogoutSequence/);
});
