import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  getSupabaseUserByUid,
  parseBearerToken,
  verifyAccessToken,
} from "../src/lib/auth/access-token.ts";

const TEST_SECRET = "test-secret-must-be-at-least-32-bytes-long-for-hs256";
const TEST_ISSUER = "https://test.supabase.co/auth/v1";
const TEST_AUDIENCE = "authenticated";

test("parseBearerToken extracts token from Authorization header", () => {
  assert.equal(parseBearerToken("Bearer abc123"), "abc123");
  assert.equal(parseBearerToken("abc123"), null);
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken("Bearer "), null);
});

test("getSupabaseUserByUid accepts the direct Admin response without treating audit timestamps as revocation", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://test.supabase.co/auth/v1/admin/users/user-123");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer service-role-key");
    return Response.json({
      id: "user-123",
      banned_until: null,
      deleted_at: null,
      updated_at: "2026-07-13T10:00:00.000Z",
      last_sign_in_at: "2026-07-13T09:00:00.000Z",
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(await getSupabaseUserByUid("user-123"), {
      disabled: false,
      tokensValidAfterTime: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test("getSupabaseUserByUid rejects an Admin response for a different user", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async () => Response.json({
    user: {
      id: "different-user",
      banned_until: null,
      deleted_at: null,
    },
  })) as typeof fetch;

  try {
    await assert.rejects(
      () => getSupabaseUserByUid("user-123"),
      (error: { code?: string; status?: number }) =>
        error.code === "invalid_session" && error.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test("verifyAccessToken verifies a valid Supabase-style token", async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalIssuer = process.env.SUPABASE_JWT_ISSUER;
  const originalAudience = process.env.SUPABASE_JWT_AUDIENCE;

  process.env.JWT_SECRET = TEST_SECRET;
  process.env.SUPABASE_JWT_ISSUER = TEST_ISSUER;
  process.env.SUPABASE_JWT_AUDIENCE = TEST_AUDIENCE;

  try {
    const token = await new SignJWT({
      sub: "user-123",
      email: "test@example.com",
      app_metadata: { role: "manager" },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const verified = await verifyAccessToken(token);

    assert.equal(verified.uid, "user-123");
    assert.equal(verified.email, "test@example.com");
    assert.equal(verified.role, "manager");
    assert.equal(verified.provider, "supabase");
    assert.equal(verified.accessToken, token);
    assert.equal(verified.companyId, null);
    assert.ok(verified.authTime && verified.authTime > 0);
  } finally {
    process.env.JWT_SECRET = originalSecret;
    process.env.SUPABASE_JWT_ISSUER = originalIssuer;
    process.env.SUPABASE_JWT_AUDIENCE = originalAudience;
  }
});

test("verifyAccessToken rejects a tampered token", async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalIssuer = process.env.SUPABASE_JWT_ISSUER;

  process.env.JWT_SECRET = TEST_SECRET;
  process.env.SUPABASE_JWT_ISSUER = TEST_ISSUER;

  try {
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const tampered = token.slice(0, -5) + "XXXXX";

    await assert.rejects(
      () => verifyAccessToken(tampered),
      (err: { code?: string; status?: number }) => err.code === "invalid_token" && err.status === 401,
    );
  } finally {
    process.env.JWT_SECRET = originalSecret;
    process.env.SUPABASE_JWT_ISSUER = originalIssuer;
  }
});

test("verifyAccessToken rejects an expired token", async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalIssuer = process.env.SUPABASE_JWT_ISSUER;

  process.env.JWT_SECRET = TEST_SECRET;
  process.env.SUPABASE_JWT_ISSUER = TEST_ISSUER;

  try {
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(new TextEncoder().encode(TEST_SECRET));

    await assert.rejects(
      () => verifyAccessToken(token),
      (err: { code?: string; status?: number }) => err.code === "invalid_token" && err.status === 401,
    );
  } finally {
    process.env.JWT_SECRET = originalSecret;
    process.env.SUPABASE_JWT_ISSUER = originalIssuer;
  }
});

test("verifyAccessToken fails closed when JWT_SECRET is missing", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "";

  try {
    await assert.rejects(
      () => verifyAccessToken("any.token.here"),
      (err: { code?: string; status?: number }) => err.code === "jwt_secret_missing" && err.status === 500,
    );
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});
