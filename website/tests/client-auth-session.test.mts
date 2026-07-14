import test from "node:test";
import assert from "node:assert/strict";
import {
  hasClientAuthSession,
  isLogoutInProgress,
  signInWithConfiguredProvider,
  signOutConfiguredProvider,
} from "../src/lib/firebase/client-auth.ts";
import {
  clearSessionIfStillUnauthenticated,
  resolveUnauthenticatedSession,
} from "../src/lib/auth/client-session-reconciliation.ts";

function createSessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("sign in waits for the HttpOnly website session before resolving", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sessionStorage = createSessionStorage();
  let releaseSessionRequest = () => {};
  const sessionRequestGate = new Promise<void>((resolve) => {
    releaseSessionRequest = resolve;
  });
  let sessionRequestBody: unknown = null;
  let sessionRequestSeen = false;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/token?grant_type=password")) {
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "user-123", email: "user@example.com" },
      });
    }
    if (url === "/api/auth/session") {
      sessionRequestSeen = true;
      sessionRequestBody = JSON.parse(String(init?.body));
      await sessionRequestGate;
      return Response.json({ ok: true });
    }
    if (url.endsWith("/auth/v1/logout")) {
      return Response.json({});
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    let signInResolved = false;
    const signInPromise = signInWithConfiguredProvider("user@example.com", "password123")
      .then((user) => {
        signInResolved = true;
        return user;
      });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sessionRequestSeen, true);
    assert.deepEqual(sessionRequestBody, { token: "access-token" });
    assert.equal(signInResolved, false);

    releaseSessionRequest();
    assert.deepEqual(await signInPromise, {
      uid: "user-123",
      email: "user@example.com",
    });
    assert.equal(signInResolved, true);
  } finally {
    releaseSessionRequest();
    await signOutConfiguredProvider();
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  }
});

test("a delayed signed-out restore cannot clear a session established by concurrent sign-in", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sessionStorage = createSessionStorage();
  let releaseRestoreRequest = () => {};
  const restoreRequestGate = new Promise<void>((resolve) => {
    releaseRestoreRequest = resolve;
  });
  let markRestoreRequestStarted = () => {};
  const restoreRequestStarted = new Promise<void>((resolve) => {
    markRestoreRequestStarted = resolve;
  });
  let websiteSessionCreated = false;
  let websiteSessionDeletes = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (url === "/api/auth/session" && method === "GET") {
      markRestoreRequestStarted();
      await restoreRequestGate;
      return Response.json({ ok: false }, { status: 401 });
    }
    if (url.endsWith("/auth/v1/token?grant_type=password")) {
      return Response.json({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "user-123", email: "user@example.com" },
      });
    }
    if (url === "/api/auth/session" && method === "POST") {
      websiteSessionCreated = true;
      return Response.json({ ok: true });
    }
    if (url === "/api/auth/session" && method === "DELETE") {
      websiteSessionDeletes += 1;
      return Response.json({ ok: true });
    }
    if (url.endsWith("/auth/v1/logout")) {
      return Response.json({});
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const resolutionPromise = resolveUnauthenticatedSession({
      loadSessionUser: async () => {
        const response = await fetch("/api/auth/session", { method: "GET" });
        return response.ok ? { uid: "restored-user", email: null } : null;
      },
      hasClientAuthSession,
      isLogoutInProgress,
    });

    await restoreRequestStarted;
    await signInWithConfiguredProvider("user@example.com", "password123");
    assert.equal(websiteSessionCreated, true);

    releaseRestoreRequest();
    assert.deepEqual(await resolutionPromise, { kind: "superseded" });
    assert.equal(websiteSessionDeletes, 0);

    // Also cover the narrower interleaving where the restore decision finishes
    // first and sign-in completes immediately before the destructive action.
    await signOutConfiguredProvider();
    websiteSessionCreated = false;
    const lateResolution = await resolveUnauthenticatedSession({
      loadSessionUser: async () => null,
      hasClientAuthSession,
      isLogoutInProgress,
    });
    assert.deepEqual(lateResolution, { kind: "clear" });

    await signInWithConfiguredProvider("user@example.com", "password123");
    assert.equal(websiteSessionCreated, true);
    const cleared = await clearSessionIfStillUnauthenticated({
      clearSession: async () => {
        await fetch("/api/auth/session", { method: "DELETE" });
      },
      hasClientAuthSession,
      isLogoutInProgress,
    });
    assert.equal(cleared, false);
    assert.equal(websiteSessionDeletes, 0);
  } finally {
    releaseRestoreRequest();
    await signOutConfiguredProvider();
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  }
});
