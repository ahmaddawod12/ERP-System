import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginRedirectUrl,
  extractCookieValue,
  hasValidRevocationCheckedSession,
} from "../src/lib/auth/session-middleware.ts";
import {
  createSessionCookieValue,
  verifySessionCookieValue,
} from "../src/lib/auth/session-token.ts";

process.env.SESSION_COOKIE_SECRET = "test-session-secret";

test("extractCookieValue reads the session cookie from a header", () => {
  assert.equal(
    extractCookieValue("theme=dark; __session=test-token; other=1", "__session"),
    "test-token",
  );
  assert.equal(extractCookieValue("theme=dark", "__session"), null);
  assert.equal(extractCookieValue("__session=%E0%A4%A", "__session"), null);
});

test("buildLoginRedirectUrl preserves the requested app path and query", () => {
  assert.equal(
    buildLoginRedirectUrl("https://example.com/app/jobs?filter=open", "/app/jobs", "?filter=open"),
    "https://example.com/login?redirect=%2Fapp%2Fjobs%3Ffilter%3Dopen",
  );
});

test("hasValidRevocationCheckedSession rejects missing session cookies", async () => {
  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app",
    null,
  );

  assert.equal(result, false);
});

test("session tokens round-trip and keep the auth payload", async () => {
  const cookieValue = await createSessionCookieValue({
    uid: "user-123",
    provider: "supabase",
    email: "user@example.com",
    role: "manager",
    companyId: "1007",
    authTime: 1710000000,
  });

  const sessionPayload = await verifySessionCookieValue(cookieValue);

  assert.deepEqual(sessionPayload, {
    uid: "user-123",
    provider: "supabase",
    email: "user@example.com",
    role: "manager",
    companyId: "1007",
    authTime: 1710000000,
  });
});

test("hasValidRevocationCheckedSession accepts a valid signed session cookie", async () => {
  const cookieValue = await createSessionCookieValue({ uid: "user-123", provider: "supabase" });

  let fetchUrl: string | null = null;
  let fetchCookieHeader: string | null = null;

  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app/jobs",
    `__session=${encodeURIComponent(cookieValue)}; theme=dark`,
    async (input, init) => {
      fetchUrl = String(input);
      fetchCookieHeader = init?.headers && "cookie" in init.headers
        ? String((init.headers as Record<string, string>).cookie || "")
        : null;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );

  assert.equal(result, true);
  assert.equal(fetchUrl, "https://example.com/api/auth/session");
  assert.equal(fetchCookieHeader, `__session=${encodeURIComponent(cookieValue)}; theme=dark`);
});

test("hasValidRevocationCheckedSession rejects a tampered signed session cookie", async () => {
  const cookieValue = await createSessionCookieValue({ uid: "user-123", provider: "supabase" });

  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app/jobs",
    `__session=${encodeURIComponent(`${cookieValue}broken`)}`,
  );

  assert.equal(result, false);
});

test("hasValidRevocationCheckedSession rejects when server validation fails", async () => {
  const cookieValue = await createSessionCookieValue({ uid: "user-999", provider: "supabase" });

  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app/jobs",
    `__session=${encodeURIComponent(cookieValue)}`,
    async () => new Response(JSON.stringify({ ok: false }), { status: 401 }),
  );

  assert.equal(result, false);
});