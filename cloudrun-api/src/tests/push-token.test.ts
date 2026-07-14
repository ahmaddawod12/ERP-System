import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
  ApiRequestAuthenticator,
  SupabaseUserClient,
} from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerPushTokenRoutes } from "../routes/push-token.js";

const userId = "a1624b1f-42ce-4f17-9fd9-80f48c874bfd";
const accessToken = "header.payload.signature";
const deviceToken = "fcm:opaque-device-token-123456789";
const deviceId = "install-a1624b1f-42ce-4f17-9fd9-80f48c874bfd";

function bearerAuthenticator(): ApiRequestAuthenticator {
  return {
    async authenticate() {
      return {
        scheme: "bearer",
        userId,
        expiresAt: 4_102_444_800,
        accessToken,
      };
    },
  };
}

function verifiedSupabaseUser(): SupabaseUserClient {
  return {
    async getUser(token) {
      assert.equal(token, accessToken);
      return {
        userId,
        email: "field-user@example.test",
        emailVerified: true,
      };
    },
  };
}

function databaseUsing(transaction: DatabaseQueryable): ApiDatabaseRuntime {
  return {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, userId);
      return work(transaction);
    },
  };
}

test("push-token routes write only the authenticated profile and never return or log the token", async (context) => {
  let logs = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += String(chunk);
      callback();
    },
  });
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queries.push(values === undefined ? { text } : { text, values });
      const rows = text.includes("register_api_push_device")
        ? [{
            push_token_platform: "android",
            push_token_updated_at: new Date("2026-07-13T12:00:00.000Z"),
          }]
        : [{ cleared: true }];
      return { rowCount: rows.length, rows: rows as unknown as Row[] };
    },
  };
  const app = await buildApp({
    config: loadConfig({}),
    logger: { level: "info", stream },
  });
  context.after(() => app.close());
  registerPushTokenRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing(transaction),
    supabaseUsers: verifiedSupabaseUser(),
  });

  const upsertResponse = await app.inject({
    method: "POST",
    url: "/api/v1/me/push-token",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { deviceId, token: deviceToken, platform: "android" },
  });
  assert.equal(upsertResponse.statusCode, 200, upsertResponse.body);
  assert.deepEqual(upsertResponse.json().data, {
    registered: true,
    platform: "android",
    pushTokenUpdatedAt: "2026-07-13T12:00:00.000Z",
  });
  assert.doesNotMatch(upsertResponse.body, /opaque-device-token/);
  assert.deepEqual(queries[0]?.values, [deviceId, deviceToken, "android"]);
  assert.match(queries[0]?.text ?? "", /private\.register_api_push_device/);
  assert.doesNotMatch(queries[0]?.text ?? "", /app_users|push_token\s*=/i);

  const clearResponse = await app.inject({
    method: "DELETE",
    url: "/api/v1/me/push-token",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { deviceId },
  });
  assert.equal(clearResponse.statusCode, 200, clearResponse.body);
  assert.deepEqual(clearResponse.json().data, { cleared: true });
  assert.match(queries[1]?.text ?? "", /private\.clear_api_push_device/);
  assert.deepEqual(queries[1]?.values, [deviceId]);
  assert.doesNotMatch(logs, /opaque-device-token|header\.payload\.signature/);
});

test("push-token mutation requires an authoritative verified email", async (context) => {
  let databaseCalls = 0;
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerPushTokenRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: {
      ...databaseUsing({
        async query<Row extends QueryResultRow>() {
          return { rowCount: 0, rows: [] as Row[] };
        },
      }),
      async withTransaction() {
        databaseCalls += 1;
        throw new Error("database must not run for an unverified user");
      },
    },
    supabaseUsers: {
      async getUser() {
        return { userId, email: "pending@example.test", emailVerified: false };
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/me/push-token",
    payload: { deviceId, token: deviceToken, platform: "ios" },
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().error.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(databaseCalls, 0);
});

test("push-token route rejects unsupported platforms before writing", async (context) => {
  let databaseCalls = 0;
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerPushTokenRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: {
      ...databaseUsing({
        async query<Row extends QueryResultRow>() {
          return { rowCount: 0, rows: [] as Row[] };
        },
      }),
      async withTransaction() {
        databaseCalls += 1;
        throw new Error("database must not run for invalid input");
      },
    },
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/me/push-token",
    payload: { deviceId, token: deviceToken, platform: "web" },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(databaseCalls, 0);
});

test("missing authenticated profile produces a stable not-found response", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerPushTokenRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing({
      async query<_Row extends QueryResultRow>() {
        throw Object.assign(new Error("PUSH_DEVICE_USER_NOT_FOUND"), { code: "P0002" });
      },
    }),
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/me/push-token",
    payload: { deviceId, token: deviceToken, platform: "android" },
  });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(response.json().error.code, "PROFILE_NOT_FOUND");
  assert.doesNotMatch(response.body, /opaque-device-token/);
});
