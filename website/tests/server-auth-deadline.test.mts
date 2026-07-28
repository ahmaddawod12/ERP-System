import assert from "node:assert/strict";
import test from "node:test";

import { serverSignUp } from "../src/lib/auth/server-firebase.ts";

test("server Auth calls carry an AbortController deadline signal", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FIREBASE_WEB_API_KEY;
  const previousTimeout = process.env.FIREBASE_AUTH_TIMEOUT_MS;
  const receivedSignals: AbortSignal[] = [];

  process.env.FIREBASE_WEB_API_KEY = "firebase-test-api-key-123456789";
  process.env.FIREBASE_AUTH_TIMEOUT_MS = "1000";
  globalThis.fetch = async (_input, init) => {
    if (init?.signal instanceof AbortSignal) {
      receivedSignals.push(init.signal);
    }
    return new Response(JSON.stringify({ idToken: "header.payload.signature" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await serverSignUp(
      "person@example.test",
      "a-valid-password",
      "https://app.example.test/auth/confirm",
    );
    assert.equal(receivedSignals.length, 2);
    assert.equal(receivedSignals[0]?.aborted, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FIREBASE_WEB_API_KEY;
    else process.env.FIREBASE_WEB_API_KEY = previousKey;
    if (previousTimeout === undefined) delete process.env.FIREBASE_AUTH_TIMEOUT_MS;
    else process.env.FIREBASE_AUTH_TIMEOUT_MS = previousTimeout;
  }
});
