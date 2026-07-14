import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseUserClient } from "../auth/index.js";
import { AppError } from "../http/errors.js";

const baseUrl = new URL("https://project.supabase.co");
const publishableKey = "sb_publishable_test_key_123456789";
const accessToken = "header.payload.signature";
const userId = "86f56882-f567-4f64-b40a-d1297f4b1132";

test("Supabase user lookup returns only verified identity fields", async () => {
  const client = createSupabaseUserClient({
    baseUrl,
    publishableKey,
    fetch: async (input, init) => {
      assert.equal(String(input), "https://project.supabase.co/auth/v1/user");
      assert.equal(init?.headers instanceof Headers, false);
      assert.deepEqual(init?.headers, {
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      });
      return Response.json({
        id: userId,
        email: "viewer@example.test",
        email_confirmed_at: "2026-07-13T10:00:00.000Z",
        user_metadata: { role: "dev", companyId: 999 },
        app_metadata: { role: "dev" },
      });
    },
  });

  assert.deepEqual(await client.getUser(accessToken), {
    userId,
    email: "viewer@example.test",
    emailVerified: true,
  });
});

test("Supabase user lookup maps invalid tokens and outages safely", async () => {
  const invalidClient = createSupabaseUserClient({
    baseUrl,
    publishableKey,
    fetch: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(invalidClient.getUser(accessToken), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "AUTHORIZATION_INVALID");
    assert.doesNotMatch(error.message, /header|payload|signature/);
    return true;
  });

  const unavailableClient = createSupabaseUserClient({
    baseUrl,
    publishableKey,
    fetch: async () => {
      throw new Error("network unavailable");
    },
  });
  await assert.rejects(unavailableClient.getUser(accessToken), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "AUTH_SERVICE_UNAVAILABLE");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("Supabase user lookup treats malformed success payloads as unavailable", async () => {
  const client = createSupabaseUserClient({
    baseUrl,
    publishableKey,
    fetch: async () => Response.json({ id: "not-a-uuid" }),
  });

  await assert.rejects(client.getUser(accessToken), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "AUTH_SERVICE_UNAVAILABLE");
    return true;
  });
});

test("phone confirmation alone never marks an email as verified", async () => {
  const client = createSupabaseUserClient({
    baseUrl,
    publishableKey,
    fetch: async () => Response.json({
      id: userId,
      email: "viewer@example.test",
      email_confirmed_at: null,
      phone_confirmed_at: "2026-07-13T10:00:00.000Z",
      confirmed_at: "2026-07-13T10:00:00.000Z",
    }),
  });

  assert.equal((await client.getUser(accessToken)).emailVerified, false);
});
