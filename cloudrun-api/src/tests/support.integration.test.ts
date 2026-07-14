import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerSupportRoutes } from "../routes/support.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The support integration test only runs against a loopback database",
  );
  return url;
}

function contextualRuntime(client: Client): ApiDatabaseRuntime {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      const result = await client.query<Row>(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };
  return {
    maxConnections: 1,
    async checkReadiness() {
      await client.query("SELECT 1");
    },
    async close() {},
    async withTransaction(context, work) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE smart_job_api");
        await client.query(
          "SELECT private.set_api_request_context($1::uuid, 12000, 3000, 15000)",
          [context.userId],
        );
        const result = await work(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
  };
}

if (adminDatabaseUrl.length === 0) {
  test("support conversations enforce ownership, idempotency, and microsecond cursors", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for support integration",
  }, () => undefined);
} else {
  test("support conversations enforce ownership, idempotency, and microsecond cursors", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const developerId = randomUUID();
    const companyId = randomUUID();
    const publicCompanyId = 8_300_000_000_000 + randomInt(500_000);
    const precisionConversationIds = Array.from({ length: 3 }, () => randomUUID())
      .sort()
      .reverse();
    const precisionMessageIds = Array.from({ length: 3 }, () => randomUUID()).sort();
    let activeUserId = ownerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO public.app_users (id, email, display_name, system_role)
         VALUES
           ($1, $2, 'Support Owner', NULL),
           ($3, $4, 'Support Stranger', NULL),
           ($5, $6, 'Support Developer', 'dev')`,
        [
          ownerId,
          `support-owner-${ownerId}@example.invalid`,
          strangerId,
          `support-stranger-${strangerId}@example.invalid`,
          developerId,
          `support-dev-${developerId}@example.invalid`,
        ],
      );
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES ($1, $2, 'business', 'active', $3)`,
        [companyId, publicCompanyId, ownerId],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (company_id, en_name, registered_by_user_id)
         VALUES ($1, 'Support Fixture', $2)`,
        [companyId, ownerId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES ($1, 'Basic', 'active', '{}'::jsonb)`,
        [companyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, 1, 'basic', 'active', 'Support Owner'),
           ($1, $3, 2, 'basic', 'active', 'Support Stranger')`,
        [companyId, ownerId, strangerId],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "support.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerSupportRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        supabaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `verified-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const createPayload = { companyId: publicCompanyId, category: "bug" };
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/support/conversations",
        headers: { "idempotency-key": "support-create-fixture-1" },
        payload: createPayload,
      });
      assert.equal(created.statusCode, 201, created.body);
      const conversationId = created.json().data.id as string;
      assert.equal(created.json().data.userId, ownerId);
      assert.equal(created.json().data.companyId, publicCompanyId);
      assert.equal(created.json().data.category, "bug");

      const createReplay = await app.inject({
        method: "POST",
        url: "/api/v1/support/conversations",
        headers: { "idempotency-key": "support-create-fixture-1" },
        payload: createPayload,
      });
      assert.equal(createReplay.statusCode, 201, createReplay.body);
      assert.equal(createReplay.json().data.id, conversationId);

      const userMessage = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/messages`,
        headers: { "idempotency-key": "support-message-fixture-1" },
        payload: { text: "The field app cannot open this job." },
      });
      assert.equal(userMessage.statusCode, 201, userMessage.body);
      assert.equal(userMessage.json().data.senderUid, ownerId);

      const messageReplay = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/messages`,
        headers: { "idempotency-key": "support-message-fixture-1" },
        payload: { text: "The field app cannot open this job." },
      });
      assert.equal(messageReplay.statusCode, 201, messageReplay.body);
      assert.equal(messageReplay.json().data.id, userMessage.json().data.id);
      const storedMessages = await admin.query(
        "SELECT count(*)::integer AS count FROM public.support_messages WHERE conversation_id = $1",
        [conversationId],
      );
      assert.equal(storedMessages.rows[0].count, 1);

      const ownerList = await app.inject({
        method: "GET",
        url: "/api/v1/support/conversations?status=open&pageSize=1",
      });
      assert.equal(ownerList.statusCode, 200, ownerList.body);
      assert.equal(ownerList.json().data.items.length, 1);
      assert.equal(ownerList.json().data.items[0].unreadForDev, 1);

      await admin.query(
        `INSERT INTO public.support_conversations (
           id, user_id, company_id, category, status, last_message_text,
           last_message_at, created_at, updated_at
         ) VALUES
           ($1, $4, $5, 'support', 'closed', 'Precision high',
            '2026-07-13T12:00:00.123456Z', '2026-07-13T12:00:00.123456Z', '2026-07-13T12:00:00.123456Z'),
           ($2, $4, $5, 'support', 'closed', 'Precision low',
            '2026-07-13T12:00:00.123456Z', '2026-07-13T12:00:00.123456Z', '2026-07-13T12:00:00.123456Z'),
           ($3, $4, $5, 'support', 'closed', 'Precision older',
            '2026-07-13T12:00:00.123200Z', '2026-07-13T12:00:00.123200Z', '2026-07-13T12:00:00.123200Z')`,
        [
          precisionConversationIds[0],
          precisionConversationIds[1],
          precisionConversationIds[2],
          ownerId,
          companyId,
        ],
      );
      const precisionConversationFirstPage = await app.inject({
        method: "GET",
        url: "/api/v1/support/conversations?status=closed&pageSize=2",
      });
      assert.equal(
        precisionConversationFirstPage.statusCode,
        200,
        precisionConversationFirstPage.body,
      );
      const precisionConversationCursor = String(
        precisionConversationFirstPage.json().data.nextCursor,
      );
      const precisionConversationSecondPage = await app.inject({
        method: "GET",
        url: "/api/v1/support/conversations?status=closed&pageSize=2"
          + `&afterCursor=${encodeURIComponent(precisionConversationCursor)}`,
      });
      assert.equal(
        precisionConversationSecondPage.statusCode,
        200,
        precisionConversationSecondPage.body,
      );
      const traversedConversationIds = [
        ...precisionConversationFirstPage.json().data.items.map(
          (conversation: { id: string }) => conversation.id,
        ),
        ...precisionConversationSecondPage.json().data.items.map(
          (conversation: { id: string }) => conversation.id,
        ),
      ];
      assert.deepEqual(traversedConversationIds, precisionConversationIds);
      assert.equal(new Set(traversedConversationIds).size, traversedConversationIds.length);
      assert.equal(precisionConversationSecondPage.json().data.nextCursor, null);

      activeUserId = strangerId;
      const strangerThread = await app.inject({
        method: "GET",
        url: `/api/v1/support/conversations/${conversationId}/messages`,
      });
      assert.equal(strangerThread.statusCode, 404, strangerThread.body);
      const strangerList = await app.inject({
        method: "GET",
        url: "/api/v1/support/conversations?status=open",
      });
      assert.equal(strangerList.statusCode, 200, strangerList.body);
      assert.equal(strangerList.json().data.items.length, 0);

      activeUserId = developerId;
      const developerList = await app.inject({
        method: "GET",
        url: "/api/v1/support/conversations?status=open",
      });
      assert.equal(developerList.statusCode, 200, developerList.body);
      assert.equal(developerList.json().data.items[0].id, conversationId);

      const developerMessage = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/messages`,
        headers: { "idempotency-key": "support-message-fixture-dev-1" },
        payload: { text: "Thanks. We are investigating the issue." },
      });
      assert.equal(developerMessage.statusCode, 201, developerMessage.body);
      assert.equal(developerMessage.json().data.senderUid, "dev");

      activeUserId = ownerId;
      const thread = await app.inject({
        method: "GET",
        url: `/api/v1/support/conversations/${conversationId}/messages?pageSize=50`,
      });
      assert.equal(thread.statusCode, 200, thread.body);
      assert.deepEqual(
        thread.json().data.messages.map((message: { senderUid: string }) => message.senderUid),
        [ownerId, "dev"],
      );
      assert.equal(thread.json().data.conversation.unreadForUser, 1);

      const userMessageId = String(userMessage.json().data.id);
      const developerMessageId = String(developerMessage.json().data.id);
      await admin.query(
        `UPDATE public.support_messages
         SET created_at = CASE id
           WHEN $1::uuid THEN '2026-07-13T12:00:00.122000Z'::timestamptz
           WHEN $2::uuid THEN '2026-07-13T12:00:00.123000Z'::timestamptz
           ELSE created_at
         END
         WHERE id IN ($1::uuid, $2::uuid)`,
        [userMessageId, developerMessageId],
      );
      await admin.query(
        `INSERT INTO public.support_messages (
           id, conversation_id, sender_user_id, sender_type,
           sender_name_snapshot, text, created_at
         ) VALUES
           ($1, $4, $5, 'user', 'Support Owner', 'Precision low',
            '2026-07-13T12:00:00.123456Z'),
           ($2, $4, $5, 'user', 'Support Owner', 'Precision high',
            '2026-07-13T12:00:00.123456Z'),
           ($3, $4, $5, 'user', 'Support Owner', 'Precision newer',
            '2026-07-13T12:00:00.123700Z')`,
        [
          precisionMessageIds[0],
          precisionMessageIds[1],
          precisionMessageIds[2],
          conversationId,
          ownerId,
        ],
      );

      const precisionMessageFirstPage = await app.inject({
        method: "GET",
        url: `/api/v1/support/conversations/${conversationId}/messages?pageSize=2`,
      });
      assert.equal(precisionMessageFirstPage.statusCode, 200, precisionMessageFirstPage.body);
      const firstMessageCursor = String(precisionMessageFirstPage.json().data.nextCursor);
      const precisionMessageSecondPage = await app.inject({
        method: "GET",
        url: `/api/v1/support/conversations/${conversationId}/messages?pageSize=2`
          + `&afterCursor=${encodeURIComponent(firstMessageCursor)}`,
      });
      assert.equal(precisionMessageSecondPage.statusCode, 200, precisionMessageSecondPage.body);
      const secondMessageCursor = String(precisionMessageSecondPage.json().data.nextCursor);
      const precisionMessageThirdPage = await app.inject({
        method: "GET",
        url: `/api/v1/support/conversations/${conversationId}/messages?pageSize=2`
          + `&afterCursor=${encodeURIComponent(secondMessageCursor)}`,
      });
      assert.equal(precisionMessageThirdPage.statusCode, 200, precisionMessageThirdPage.body);
      const traversedMessageIds = [
        ...precisionMessageFirstPage.json().data.messages.map(
          (message: { id: string }) => message.id,
        ),
        ...precisionMessageSecondPage.json().data.messages.map(
          (message: { id: string }) => message.id,
        ),
        ...precisionMessageThirdPage.json().data.messages.map(
          (message: { id: string }) => message.id,
        ),
      ];
      assert.deepEqual(traversedMessageIds, [
        userMessageId,
        developerMessageId,
        ...precisionMessageIds,
      ]);
      assert.equal(new Set(traversedMessageIds).size, traversedMessageIds.length);
      assert.equal(precisionMessageThirdPage.json().data.nextCursor, null);

      const markedRead = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/read`,
        headers: { "idempotency-key": "support-read-fixture-1" },
      });
      assert.equal(markedRead.statusCode, 200, markedRead.body);
      assert.equal(markedRead.json().data.unreadForUser, 0);

      const closed = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/close`,
        headers: { "idempotency-key": "support-close-fixture-1" },
      });
      assert.equal(closed.statusCode, 200, closed.body);
      assert.equal(closed.json().data.status, "closed");

      const appendClosed = await app.inject({
        method: "POST",
        url: `/api/v1/support/conversations/${conversationId}/messages`,
        headers: { "idempotency-key": "support-message-after-close-1" },
        payload: { text: "One more detail" },
      });
      assert.equal(appendClosed.statusCode, 409, appendClosed.body);
      assert.equal(appendClosed.json().error.code, "SUPPORT_CONVERSATION_CLOSED");
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query(
        "DELETE FROM private.api_idempotency WHERE user_id IN ($1, $2, $3)",
        [ownerId, strangerId, developerId],
      ).catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = $1", [companyId])
        .catch(() => undefined);
      await admin.query(
        "DELETE FROM public.app_users WHERE id IN ($1, $2, $3)",
        [ownerId, strangerId, developerId],
      ).catch(() => undefined);
      await admin.end();
    }
  });
}
