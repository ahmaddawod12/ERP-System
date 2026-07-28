import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyRequest } from "fastify";

import {
  parseAuthorizationCredential,
  parseBearerAuthorization,
} from "../auth/authorization.js";
import { AuthError } from "../auth/errors.js";
import { createFirebaseTokenVerifier } from "../auth/firebase-token.js";
import { createApiRequestAuthenticator } from "../auth/request.js";

const TOKEN = "header.payload.signature";
const PROJECT_ID = "smart-job-test";
const FIREBASE_UID = "firebase-user-123";
const NOW = Math.floor(Date.now() / 1_000);

function verifier(overrides: Record<string, unknown> = {}) {
  return createFirebaseTokenVerifier({
    projectId: PROJECT_ID,
    auth: {
      async verifyIdToken() {
        return {
          aud: PROJECT_ID,
          iss: `https://securetoken.google.com/${PROJECT_ID}`,
          uid: FIREBASE_UID,
          sub: FIREBASE_UID,
          exp: NOW + 600,
          iat: NOW,
          auth_time: NOW - 10,
          firebase: { identities: {}, sign_in_provider: "password" },
          ...overrides,
        };
      },
    },
  });
}

test("strict authorization parsing rejects ambiguous credentials", () => {
  assert.equal(parseBearerAuthorization(`Bearer ${TOKEN}`), TOKEN);
  assert.deepEqual(parseAuthorizationCredential(`Bearer ${TOKEN}`), {
    scheme: "bearer",
    token: TOKEN,
  });
  const sessionToken = "S".repeat(43);
  assert.deepEqual(parseAuthorizationCredential(`SmartJobSession ${sessionToken}`), {
    scheme: "smart-job-session",
    token: sessionToken,
  });
  for (const header of [
    "",
    "Basic abc.def.ghi",
    `Bearer ${TOKEN}, SmartJobSession ${sessionToken}`,
    `SmartJobSession ${"S".repeat(42)}`,
  ]) {
    assert.throws(
      () => parseAuthorizationCredential(header),
      (error) => error instanceof AuthError,
    );
  }
});

test("Firebase tokens map provider UIDs to stable internal UUIDs", async () => {
  const first = await verifier().verifyAccessToken(TOKEN);
  const second = await verifier().verifyAuthorizationHeader(`Bearer ${TOKEN}`);
  assert.equal(first.userId, second.userId);
  assert.match(first.userId, /^[0-9a-f-]{36}$/);
  assert.equal(first.providerUserId, FIREBASE_UID);
  assert.equal(first.expiresAt, NOW + 600);
  assert.equal(first.authenticatedAt, NOW - 10);
});

test("Firebase verifier rejects wrong projects, malformed UIDs, and expired tokens", async () => {
  for (const overrides of [
    { aud: "wrong-project" },
    { iss: "https://securetoken.google.com/wrong-project" },
    { uid: "" },
  ]) {
    await assert.rejects(
      () => verifier(overrides).verifyAccessToken(TOKEN),
      (error) => error instanceof AuthError && error.code === "AUTHORIZATION_INVALID",
    );
  }
  const expired = createFirebaseTokenVerifier({
    projectId: PROJECT_ID,
    auth: {
      async verifyIdToken() {
        throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
      },
    },
  });
  await assert.rejects(
    () => expired.verifyAccessToken(TOKEN),
    (error) => error instanceof AuthError && error.code === "ACCESS_TOKEN_EXPIRED",
  );
});

test("unified authentication keeps Firebase bearer tokens out of opaque sessions", async () => {
  const jwtVerifier = verifier();
  const identity = await jwtVerifier.verifyAccessToken(TOKEN);
  const absoluteExpiresAt = new Date("2026-07-30T00:00:00.000Z");
  const authenticator = createApiRequestAuthenticator({
    jwtVerifier,
    webSessions: {
      async authenticateSession() {
        return {
          userId: identity.userId,
          verifiedEmail: "viewer@example.test",
          absoluteExpiresAt,
        };
      },
    },
  });
  const request = (authorization: string): FastifyRequest => ({
    headers: { authorization },
  }) as FastifyRequest;

  const bearer = await authenticator.authenticate(request(`Bearer ${TOKEN}`));
  assert.equal(bearer.scheme, "bearer");
  assert.equal(bearer.userId, identity.userId);

  const opaque = await authenticator.authenticate(
    request(`SmartJobSession ${"O".repeat(43)}`),
  );
  assert.equal(opaque.scheme, "smart-job-session");
  assert.equal(Reflect.has(opaque, "accessToken"), false);
  assert.equal(Reflect.has(opaque, "refreshToken"), false);
});
