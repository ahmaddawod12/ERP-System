import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  WebSessionCsrfTokenSchema,
  WebSessionTokenSchema,
  type WebSessionCreated,
  type WebSessionCurrent,
} from "@smart-job/api-contracts";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { AppError } from "../http/errors.js";
import { registerWebSessionRoutes } from "../routes/web-sessions.js";
import { createWebSessionCrypto } from "../web-sessions/crypto.js";
import { lockActiveWebSession, readActiveWebSession } from "../web-sessions/repository.js";
import type { WebSessionService } from "../web-sessions/service.js";

const sessionToken = WebSessionTokenSchema.parse("A".repeat(43));
const csrfToken = WebSessionCsrfTokenSchema.parse("B".repeat(43));
const absoluteExpiresAt = "2026-07-14T00:00:00.000Z";
const viewer = {
  uid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
  email: "manager@example.test",
  displayName: "Manager",
  emailVerified: true,
  workspaces: [],
};

test("web-session routes enforce opaque authorization and CSRF without exposing Auth tokens", async (context) => {
  const calls: unknown[][] = [];
  const created: WebSessionCreated = { sessionToken, csrfToken, absoluteExpiresAt, viewer };
  const current: WebSessionCurrent = { absoluteExpiresAt, viewer };
  const service: WebSessionService = {
    async createSession(email, password) {
      calls.push(["create", email, password]);
      return created;
    },
    async authenticateSession(token) {
      calls.push(["authenticate", token]);
      return { userId: viewer.uid, absoluteExpiresAt: new Date(absoluteExpiresAt) };
    },
    async currentSession(token) {
      calls.push(["current", token]);
      return current;
    },
    async revokeSession(token, csrf) {
      calls.push(["revoke", token, csrf]);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerWebSessionRoutes(app, { webSessions: service });

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/web-sessions",
    payload: { email: " MANAGER@example.test ", password: "secret value " },
  });
  assert.equal(login.statusCode, 201, login.body);
  assert.deepEqual(login.json().data, created);
  assert.deepEqual(calls.shift(), ["create", "manager@example.test", "secret value "]);

  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/auth/web-sessions/current",
  });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().error.code, "WEB_SESSION_REQUIRED");

  const ambiguous = await app.inject({
    method: "GET",
    url: "/api/v1/auth/web-sessions/current",
    headers: {
      authorization: `SmartJobSession ${sessionToken}, SmartJobSession ${sessionToken}`,
    },
  });
  assert.equal(ambiguous.statusCode, 401);
  assert.equal(ambiguous.json().error.code, "WEB_SESSION_INVALID");

  const resolved = await app.inject({
    method: "GET",
    url: "/api/v1/auth/web-sessions/current",
    headers: { authorization: `SmartJobSession ${sessionToken}` },
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.deepEqual(resolved.json().data, current);
  assert.doesNotMatch(resolved.body, /accessToken|refreshToken|supabase/i);
  assert.deepEqual(calls.shift(), ["current", sessionToken]);

  const missingCsrf = await app.inject({
    method: "DELETE",
    url: "/api/v1/auth/web-sessions/current",
    headers: { authorization: `SmartJobSession ${sessionToken}` },
  });
  assert.equal(missingCsrf.statusCode, 403);
  assert.equal(missingCsrf.json().error.code, "CSRF_INVALID");

  const revoked = await app.inject({
    method: "DELETE",
    url: "/api/v1/auth/web-sessions/current",
    headers: {
      authorization: `SmartJobSession ${sessionToken}`,
      "x-sj-csrf": csrfToken,
    },
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.deepEqual(revoked.json().data, { revoked: true });
  assert.deepEqual(calls.shift(), ["revoke", sessionToken, csrfToken]);
});

test("AES-256-GCM credentials are bound to immutable session metadata", () => {
  const crypto = createWebSessionCrypto({
    key: Buffer.alloc(32, 17),
    keyVersion: "test-v1",
  });
  const binding = {
    id: randomUUID(),
    userId: randomUUID(),
    supabaseSessionId: randomUUID(),
    absoluteExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
  };
  const credentials = {
    accessToken: "signed-access-token",
    refreshToken: "rotating-refresh-token",
  };
  const encrypted = crypto.encrypt(binding, credentials);

  assert.deepEqual(crypto.decrypt(binding, encrypted), credentials);
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.doesNotMatch(encrypted.ciphertext.toString("utf8"), /signed|rotating/);
  assert.throws(
    () => crypto.decrypt({ ...binding, userId: randomUUID() }, encrypted),
    (error: unknown) => error instanceof AppError
      && error.code === "WEB_SESSION_DECRYPTION_FAILED",
  );
  assert.throws(
    () => crypto.decrypt(binding, { ...encrypted, keyVersion: "retired-v0" }),
    (error: unknown) => error instanceof AppError
      && error.code === "WEB_SESSION_KEY_UNAVAILABLE",
  );
  assert.equal(crypto.generateSessionToken().length, 43);
  assert.equal(crypto.generateCsrfToken().length, 43);
});

test("safely-valid session reads are lock-free while refresh reads are explicit", async () => {
  const queries: string[] = [];
  const transaction = {
    async query(text: string) {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
  };
  const tokenHash = Buffer.alloc(32, 7);
  const now = new Date("2026-07-14T00:00:00.000Z");

  await readActiveWebSession(transaction, tokenHash, now);
  await lockActiveWebSession(transaction, tokenHash, now);

  assert.doesNotMatch(queries[0] ?? "", /FOR UPDATE/i);
  assert.match(queries[1] ?? "", /FOR UPDATE/i);
});
