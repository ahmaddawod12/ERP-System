import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginRedirectUrl,
  extractCookieValue,
  hasValidRevocationCheckedSession,
} from "../src/lib/auth/session-middleware.ts";

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
  const fetchCalls: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app",
    null,
    fetchImpl,
  );

  assert.equal(result, false);
  assert.equal(fetchCalls.length, 0);
});

test("hasValidRevocationCheckedSession delegates to the session API and returns its result", async () => {
  const fetchCalls: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const result = await hasValidRevocationCheckedSession(
    "https://example.com/app/jobs",
    "__session=test-token; theme=dark",
    fetchImpl,
  );

  assert.equal(result, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(String(fetchCalls[0].input), "https://example.com/api/auth/session");
  assert.equal(fetchCalls[0].init?.method, "GET");
});