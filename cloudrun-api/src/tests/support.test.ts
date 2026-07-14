import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { DatabaseQueryable } from "../database/runtime.js";
import {
  LIST_SUPPORT_CONVERSATIONS_SQL,
  LIST_SUPPORT_MESSAGES_SQL,
  READ_SUPPORT_CONVERSATION_SQL,
  listSupportConversations,
  readSupportThread,
} from "../support/repository.js";

const userId = "3ff2c74a-b0bf-4c46-b759-dbdf23d93ab1";
const conversationHighId = "ffe77602-d9b1-4a53-97e1-52df99f97224";
const conversationLowId = "4877089d-60c8-44f6-be79-116e6f3b34cc";
const conversationOlderId = "126bf50f-51de-4cf7-a2a1-90fb615e12b5";
const messageLowId = "126bf50f-51de-4cf7-a2a1-90fb615e12b5";
const messageHighId = "ffe77602-d9b1-4a53-97e1-52df99f97224";
const messageNewerId = "4877089d-60c8-44f6-be79-116e6f3b34cc";

function conversationRow(id: string, timestamp: string) {
  return {
    id,
    user_id: userId,
    user_name: "Support User",
    public_company_id: "42",
    category: "support",
    status: "open",
    last_message_text: `Conversation ${id}`,
    last_message_at: new Date(timestamp),
    cursor_last_message_at: timestamp,
    unread_for_user_count: 0,
    unread_for_dev_count: 1,
    created_at: new Date(timestamp),
    updated_at: new Date(timestamp),
  };
}

function messageRow(id: string, conversationId: string, timestamp: string) {
  return {
    id,
    conversation_id: conversationId,
    sender_user_id: userId,
    sender_type: "user",
    sender_name_snapshot: "Support User",
    text: `Message ${id}`,
    created_at: new Date(timestamp),
    cursor_created_at: timestamp,
  };
}

function decodedCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
}

test("support conversation cursors retain PostgreSQL microseconds independently of DTO dates", async () => {
  const exactTimestamp = "2026-07-13T12:00:00.123456Z";
  let page = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      assert.equal(text, LIST_SUPPORT_CONVERSATIONS_SQL);
      page += 1;
      if (page === 1) {
        assert.deepEqual(values, [userId, null, null, null, null, 3]);
        return {
          rowCount: 3,
          rows: [
            conversationRow(conversationHighId, exactTimestamp),
            conversationRow(conversationLowId, exactTimestamp),
            conversationRow(conversationOlderId, "2026-07-13T12:00:00.123200Z"),
          ] as unknown as Row[],
        };
      }
      assert.equal(values?.[3], exactTimestamp);
      assert.equal(values?.[4], conversationLowId);
      return {
        rowCount: 1,
        rows: [conversationRow(conversationOlderId, "2026-07-13T12:00:00.123200Z")] as unknown as Row[],
      };
    },
  };

  const first = await listSupportConversations(transaction, userId, { pageSize: 2 });
  assert.equal(first.items[1]?.lastMessageAt, "2026-07-13T12:00:00.123Z");
  assert.ok(first.nextCursor);
  assert.deepEqual(decodedCursor(first.nextCursor), {
    version: 1,
    lastMessageAt: exactTimestamp,
    id: conversationLowId,
  });

  const second = await listSupportConversations(transaction, userId, {
    pageSize: 2,
    afterCursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => item.id), [conversationOlderId]);
  assert.equal(second.nextCursor, null);
});

test("support message cursors retain PostgreSQL microseconds and same-timestamp UUID order", async () => {
  const exactTimestamp = "2026-07-13T12:00:00.123456Z";
  let messagePage = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === READ_SUPPORT_CONVERSATION_SQL) {
        return {
          rowCount: 1,
          rows: [conversationRow(conversationHighId, exactTimestamp)] as unknown as Row[],
        };
      }
      assert.equal(text, LIST_SUPPORT_MESSAGES_SQL);
      messagePage += 1;
      if (messagePage === 1) {
        assert.deepEqual(values, [conversationHighId, null, null, 3]);
        return {
          rowCount: 3,
          rows: [
            messageRow(messageLowId, conversationHighId, exactTimestamp),
            messageRow(messageHighId, conversationHighId, exactTimestamp),
            messageRow(messageNewerId, conversationHighId, "2026-07-13T12:00:00.123700Z"),
          ] as unknown as Row[],
        };
      }
      assert.equal(values?.[1], exactTimestamp);
      assert.equal(values?.[2], messageHighId);
      return {
        rowCount: 1,
        rows: [
          messageRow(messageNewerId, conversationHighId, "2026-07-13T12:00:00.123700Z"),
        ] as unknown as Row[],
      };
    },
  };

  const first = await readSupportThread(transaction, {
    userId,
    conversationId: conversationHighId,
    query: { pageSize: 2 },
  });
  assert.equal(first.messages[1]?.createdAt, "2026-07-13T12:00:00.123Z");
  assert.ok(first.nextCursor);
  assert.deepEqual(decodedCursor(first.nextCursor), {
    version: 1,
    createdAt: exactTimestamp,
    id: messageHighId,
  });

  const second = await readSupportThread(transaction, {
    userId,
    conversationId: conversationHighId,
    query: { pageSize: 2, afterCursor: first.nextCursor },
  });
  assert.deepEqual(second.messages.map((message) => message.id), [messageNewerId]);
  assert.equal(second.nextCursor, null);
});

test("support pagination SQL selects exact timestamp text and keeps composite ordering", () => {
  assert.match(
    LIST_SUPPORT_CONVERSATIONS_SQL,
    /to_char\([\s\S]*last_message_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_last_message_at/,
  );
  assert.match(
    LIST_SUPPORT_CONVERSATIONS_SQL,
    /\(conversation\.last_message_at, conversation\.id\) < \(\$4::timestamptz, \$5::uuid\)/,
  );
  assert.match(
    LIST_SUPPORT_MESSAGES_SQL,
    /to_char\([\s\S]*message\.created_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_created_at/,
  );
  assert.match(
    LIST_SUPPORT_MESSAGES_SQL,
    /\(message\.created_at, message\.id\) > \(\$2::timestamptz, \$3::uuid\)/,
  );
});
