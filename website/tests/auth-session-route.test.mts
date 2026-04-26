import test from "node:test";
import assert from "node:assert/strict";
import {
  handleCreateSession,
  handleDeleteSession,
  handleReadSession,
} from "../src/lib/auth/session-route.ts";
import { verifySessionCookieValue } from "../src/lib/auth/session-token.ts";

process.env.SESSION_COOKIE_SECRET = "test-session-secret";

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function findCookieValue(response: Response, cookieName: string): string | null {
  const cookieHeader = getSetCookieHeaders(response).find((header) => header.startsWith(`${cookieName}=`));
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(new RegExp(`^${cookieName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

test("session POST rejects missing tokens", async () => {
  const response = await handleCreateSession(new Request("https://example.com/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }), {
    verifyAccessToken: async () => ({
      uid: "unused",
      provider: "supabase",
      decodedToken: null,
      claims: null,
      authTime: null,
      email: null,
      role: null,
      companyId: null,
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "missing_token" });
});

test("session POST issues a signed session cookie after access-token verification", async () => {
  let verifyCall: { token: string } | null = null;
  const response = await handleCreateSession(new Request("https://example.com/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "firebase-id-token" }),
  }), {
    verifyAccessToken: async (token) => {
      verifyCall = { token };
      return {
        uid: "user-123",
        provider: "supabase",
        email: "user@example.com",
        role: "manager",
        companyId: "1007",
        authTime: 1710000000,
        decodedToken: null,
        claims: null,
      };
    },
  });

  assert.deepEqual(verifyCall, { token: "firebase-id-token" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const sessionCookieValue = findCookieValue(response, "__session");
  assert.ok(sessionCookieValue);
  assert.notEqual(sessionCookieValue, "firebase-id-token");
  assert.deepEqual(await verifySessionCookieValue(sessionCookieValue || ""), {
    uid: "user-123",
    provider: "supabase",
    email: "user@example.com",
    role: "manager",
    companyId: "1007",
    authTime: 1710000000,
  });
});

test("session POST clears cookies when token verification fails", async () => {
  const response = await handleCreateSession(new Request("https://example.com/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "bad-token" }),
  }), {
    verifyAccessToken: async () => {
      throw new Error("invalid token");
    },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_token" });
  assert.equal(findCookieValue(response, "__session"), "");
});

test("session GET returns session payload for a valid signed session cookie", async () => {
  const createResponse = await handleCreateSession(new Request("https://example.com/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "firebase-id-token" }),
  }), {
    verifyAccessToken: async () => ({
      uid: "user-123",
      provider: "supabase",
      role: "manager",
      companyId: "1007",
      authTime: 1710000000,
      email: null,
      decodedToken: null,
      claims: null,
    }),
  });
  const sessionCookieValue = findCookieValue(createResponse, "__session");

  const response = await handleReadSession(new Request("https://example.com/api/auth/session", {
    method: "GET",
    headers: { cookie: `__session=${encodeURIComponent(sessionCookieValue || "")}` },
  }), {
    getUserByUid: async (uid) => ({
      uid,
      disabled: false,
      tokensValidAfterTime: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    session: {
      uid: "user-123",
      provider: "supabase",
      role: "manager",
      companyId: "1007",
    },
  });
});

test("session GET rejects invalid cookies and clears the session", async () => {
  const response = await handleReadSession(new Request("https://example.com/api/auth/session", {
    method: "GET",
    headers: { cookie: "__session=not-a-valid-session" },
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_session" });
  assert.equal(findCookieValue(response, "__session"), "");
});

test("session DELETE clears session cookies", async () => {
  const response = handleDeleteSession();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(findCookieValue(response, "__session"), "");
});

test("session GET rejects revoked sessions and clears the session", async () => {
  const createResponse = await handleCreateSession(new Request("https://example.com/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "firebase-id-token" }),
  }), {
    verifyAccessToken: async () => ({
      uid: "user-123",
      provider: "supabase",
      role: "manager",
      companyId: "1007",
      authTime: 1710000000,
      email: null,
      decodedToken: null,
      claims: null,
    }),
  });
  const sessionCookieValue = findCookieValue(createResponse, "__session");

  const response = await handleReadSession(new Request("https://example.com/api/auth/session", {
    method: "GET",
    headers: { cookie: `__session=${encodeURIComponent(sessionCookieValue || "")}` },
  }), {
    getUserByUid: async () => ({
      disabled: false,
      tokensValidAfterTime: new Date("2024-03-10T16:00:01.000Z").toISOString(),
    }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_session" });
  assert.equal(findCookieValue(response, "__session"), "");
});