import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseWebAuthClient } from "../auth/index.js";
import { AppError } from "../http/errors.js";

const baseUrl = new URL("https://project.supabase.co");
const publishableKey = "sb_publishable_test_key_123456789";
const userId = "86f56882-f567-4f64-b40a-d1297f4b1132";

function authResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access.header.signature",
    refresh_token: "refresh-token",
    expires_in: 3_600,
    expires_at: 2_000_000_000,
    user: {
      id: userId,
      email: "viewer@example.test",
      email_confirmed_at: "2026-07-13T10:00:00.000Z",
    },
    ...overrides,
  };
}

test("password sign-in and refresh use server-side Supabase Auth endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createSupabaseWebAuthClient({
    baseUrl,
    publishableKey,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        ...(init === undefined ? {} : { init }),
      });
      return Response.json(authResponse());
    },
  });

  const signedIn = await client.signInWithPassword("viewer@example.test", "secret");
  const refreshed = await client.refreshSession("old-refresh-token");
  assert.equal(signedIn.user?.emailVerified, true);
  assert.equal(refreshed.accessToken, "access.header.signature");
  assert.equal(requests[0]?.url, "https://project.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(requests[1]?.url, "https://project.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    email: "viewer@example.test",
    password: "secret",
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    refresh_token: "old-refresh-token",
  });
  assert.equal((requests[0]?.init?.headers as Record<string, string>).apikey, publishableKey);
  assert.equal(Reflect.has(signedIn.user ?? {}, "user_metadata"), false);
});

test("phone-only confirmation is not accepted as verified email", async () => {
  const client = createSupabaseWebAuthClient({
    baseUrl,
    publishableKey,
    fetch: async () => Response.json(authResponse({
      user: {
        id: userId,
        email: "viewer@example.test",
        email_confirmed_at: null,
        phone_confirmed_at: "2026-07-13T10:00:00.000Z",
        confirmed_at: "2026-07-13T10:00:00.000Z",
      },
    })),
  });

  assert.equal((await client.signInWithPassword("viewer@example.test", "secret")).user?.emailVerified, false);
});

test("Auth failures map to safe stable errors", async () => {
  const unverified = createSupabaseWebAuthClient({
    baseUrl,
    publishableKey,
    fetch: async () => Response.json(
      { error_code: "email_not_confirmed", message: "upstream detail" },
      { status: 400 },
    ),
  });
  await assert.rejects(
    unverified.signInWithPassword("viewer@example.test", "secret-marker"),
    (error: unknown) => error instanceof AppError
      && error.code === "EMAIL_NOT_VERIFIED"
      && !error.message.includes("marker"),
  );

  const invalidRefresh = createSupabaseWebAuthClient({
    baseUrl,
    publishableKey,
    fetch: async () => Response.json({ error_code: "refresh_token_not_found" }, { status: 400 }),
  });
  await assert.rejects(
    invalidRefresh.refreshSession("refresh-token-marker"),
    (error: unknown) => error instanceof AppError
      && error.code === "WEB_SESSION_INVALID"
      && !error.message.includes("marker"),
  );
});
