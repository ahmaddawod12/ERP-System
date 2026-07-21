import assert from "node:assert/strict";
import test from "node:test";

import { serverSignUp } from "../src/lib/auth/server-supabase.ts";

test("server Auth calls carry an AbortController deadline signal", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const previousTimeout = process.env.SUPABASE_AUTH_TIMEOUT_MS;
  const receivedSignals: AbortSignal[] = [];

  process.env.SUPABASE_URL = "https://auth.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_AUTH_TIMEOUT_MS = "1000";
  globalThis.fetch = async (_input, init) => {
    if (init?.signal instanceof AbortSignal) {
      receivedSignals.push(init.signal);
    }
    return new Response(JSON.stringify({ user: { id: "user-id" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await serverSignUp("person@example.test", "a-valid-password");
    assert.equal(receivedSignals.length, 1);
    assert.equal(receivedSignals[0]?.aborted, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
    if (previousTimeout === undefined) delete process.env.SUPABASE_AUTH_TIMEOUT_MS;
    else process.env.SUPABASE_AUTH_TIMEOUT_MS = previousTimeout;
  }
});
