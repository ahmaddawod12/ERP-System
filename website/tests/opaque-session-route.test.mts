import test from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "@smart-job/api-contracts";
import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleOpaqueSessionLogin,
  handleOpaqueSessionLogout,
  handleOpaqueSessionRead,
  type OpaqueSessionRouteDeps,
} from "../src/lib/auth/opaque-session-route-core.ts";

const SESSION_TOKEN = "s".repeat(43);
const CSRF_TOKEN = "c".repeat(43);
const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const EXPIRES_AT = "2026-07-14T00:00:00.000Z";
const VIEWER: Viewer = {
  uid: "11111111-1111-4111-8111-111111111111",
  email: "manager@example.com",
  displayName: "Manager",
  emailVerified: true,
  workspaces: [{
    companyId: 101,
    name: "Example Co",
    accountType: "business",
    role: "manager",
    memberNo: 1,
    enabledModules: ["jobs"],
  }],
};

function dependencies(overrides: Partial<OpaqueSessionRouteDeps> = {}): OpaqueSessionRouteDeps {
  return {
    websiteOrigin: "https://erp.example.com",
    nodeEnv: "production",
    now: () => NOW,
    createSession: async () => ({
      sessionToken: SESSION_TOKEN,
      csrfToken: CSRF_TOKEN,
      absoluteExpiresAt: EXPIRES_AT,
      viewer: VIEWER,
      requestId: "req-login",
    }),
    readSession: async () => ({
      absoluteExpiresAt: EXPIRES_AT,
      viewer: VIEWER,
      requestId: "req-read",
    }),
    revokeSession: async () => ({ revoked: true, requestId: "req-logout" }),
    ...overrides,
  };
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") || ""];
}

test("same-origin login creates only opaque and CSRF cookies", async () => {
  let credentials: unknown = null;
  const response = await handleOpaqueSessionLogin(new Request("https://erp.example.com/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://erp.example.com",
    },
    body: JSON.stringify({ email: "manager@example.com", password: "secret-pass" }),
  }), dependencies({
    createSession: async (input) => {
      credentials = input;
      return {
        sessionToken: SESSION_TOKEN,
        csrfToken: CSRF_TOKEN,
        absoluteExpiresAt: EXPIRES_AT,
        viewer: VIEWER,
        requestId: "req-login",
      };
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(credentials, { email: "manager@example.com", password: "secret-pass" });
  const payload = await response.json();
  assert.equal(JSON.stringify(payload).includes(SESSION_TOKEN), false);
  assert.equal(JSON.stringify(payload).includes(CSRF_TOKEN), false);
  assert.deepEqual(payload, {
    ok: true,
    data: { viewer: VIEWER, absoluteExpiresAt: EXPIRES_AT },
    meta: { requestId: "req-login" },
  });

  const cookies = setCookies(response);
  const sessionCookie = cookies.find((value) => value.startsWith("__Host-sj_web_session="));
  const csrfCookie = cookies.find((value) => value.startsWith("sj_csrf="));
  const legacySessionCookie = cookies.find((value) => value.startsWith("__session="));
  const legacyAccessCookie = cookies.find((value) => value.startsWith("__session_access="));
  assert.match(sessionCookie || "", /HttpOnly/);
  assert.match(sessionCookie || "", /Secure/);
  assert.match(sessionCookie || "", /SameSite=lax/i);
  assert.match(sessionCookie || "", /Path=\//);
  assert.match(sessionCookie || "", /Max-Age=43200/);
  assert.doesNotMatch(csrfCookie || "", /HttpOnly/);
  assert.match(csrfCookie || "", /Secure/);
  assert.match(legacySessionCookie || "", /Max-Age=0/);
  assert.match(legacyAccessCookie || "", /Max-Age=0/);
});

test("login rejects an untrusted origin before forwarding credentials", async () => {
  let called = false;
  const response = await handleOpaqueSessionLogin(new Request("https://erp.example.com/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: JSON.stringify({ email: "manager@example.com", password: "secret-pass" }),
  }), dependencies({
    createSession: async () => {
      called = true;
      throw new Error("must not run");
    },
  }));

  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("session read forwards only a valid opaque cookie and never returns it", async () => {
  let forwardedToken = "";
  const response = await handleOpaqueSessionRead(new Request(
    "https://erp.example.com/api/auth/web-session",
    { headers: { Cookie: `__Host-sj_web_session=${SESSION_TOKEN}` } },
  ), dependencies({
    readSession: async (token) => {
      forwardedToken = token;
      return { absoluteExpiresAt: EXPIRES_AT, viewer: VIEWER, requestId: "req-read" };
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(forwardedToken, SESSION_TOKEN);
  assert.equal(JSON.stringify(await response.json()).includes(SESSION_TOKEN), false);
});

test("logout requires matching double-submit CSRF and clears cookies after revocation", async () => {
  let revokeArgs: string[] = [];
  const response = await handleOpaqueSessionLogout(new Request(
    "https://erp.example.com/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://erp.example.com",
        Cookie: `__Host-sj_web_session=${SESSION_TOKEN}; sj_csrf=${CSRF_TOKEN}`,
        "X-SJ-CSRF": CSRF_TOKEN,
      },
    },
  ), dependencies({
    revokeSession: async (sessionToken, csrfToken) => {
      revokeArgs = [sessionToken, csrfToken];
      return { revoked: true, requestId: "req-logout" };
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(revokeArgs, [SESSION_TOKEN, CSRF_TOKEN]);
  assert.ok(setCookies(response).some((value) => (
    value.startsWith("__Host-sj_web_session=") && /Max-Age=0/.test(value)
  )));
});

test("logout rejects a CSRF mismatch without revoking or clearing the session", async () => {
  let called = false;
  const response = await handleOpaqueSessionLogout(new Request(
    "https://erp.example.com/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://erp.example.com",
        Cookie: `__Host-sj_web_session=${SESSION_TOKEN}; sj_csrf=${CSRF_TOKEN}`,
        "X-SJ-CSRF": "x".repeat(43),
      },
    },
  ), dependencies({
    revokeSession: async () => {
      called = true;
      return { revoked: true, requestId: "unused" };
    },
  }));

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("logout keeps cookies when backend revocation fails transiently so it can be retried", async () => {
  const response = await handleOpaqueSessionLogout(new Request(
    "https://erp.example.com/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://erp.example.com",
        Cookie: `__Host-sj_web_session=${SESSION_TOKEN}; sj_csrf=${CSRF_TOKEN}`,
        "X-SJ-CSRF": CSRF_TOKEN,
      },
    },
  ), dependencies({
    revokeSession: async () => {
      throw new BackendTransportError({
        status: 503,
        code: "BACKEND_UNAVAILABLE",
        message: "The backend is temporarily unavailable.",
        retryable: true,
        requestId: "req-retry",
      });
    },
  }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal((await response.json()).error.retryable, true);
});

test("logout clears cookies when the backend definitively rejects the session", async () => {
  const response = await handleOpaqueSessionLogout(new Request(
    "https://erp.example.com/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://erp.example.com",
        Cookie: `__Host-sj_web_session=${SESSION_TOKEN}; sj_csrf=${CSRF_TOKEN}`,
        "X-SJ-CSRF": CSRF_TOKEN,
      },
    },
  ), dependencies({
    revokeSession: async () => {
      throw new BackendTransportError({
        status: 401,
        code: "WEB_SESSION_INVALID",
        message: "The session is no longer valid.",
        requestId: "req-invalid",
      });
    },
  }));

  assert.equal(response.status, 401);
  assert.ok(setCookies(response).some((value) => /Max-Age=0/.test(value)));
});

test("invalid backend sessions are cleared and return the validated backend error", async () => {
  const response = await handleOpaqueSessionRead(new Request(
    "https://erp.example.com/api/auth/web-session",
    { headers: { Cookie: `__Host-sj_web_session=${SESSION_TOKEN}` } },
  ), dependencies({
    readSession: async () => {
      throw new BackendTransportError({
        status: 401,
        code: "SESSION_REVOKED",
        message: "The session is no longer valid.",
        requestId: "req-revoked",
      });
    },
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "SESSION_REVOKED",
      message: "The session is no longer valid.",
      retryable: false,
    },
    meta: { requestId: "req-revoked" },
  });
  assert.ok(setCookies(response).some((value) => /Max-Age=0/.test(value)));
});
