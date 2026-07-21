import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createRecoveryCsrfToken,
  openRecoveryCredential,
  RECOVERY_MAX_AGE_SECONDS,
  recoveryCookieName,
  recoveryCsrfMatches,
  sealRecoveryCredential,
} from "../src/lib/auth/password-recovery.ts";

const secret = "test-recovery-secret-with-more-than-32-characters";
const now = Date.UTC(2026, 6, 13, 10, 0, 0);

test("recovery credentials are encrypted, authenticated, and absolutely bounded", () => {
  const sealed = sealRecoveryCredential({
    accessToken: "header.payload.signature",
    expiresAt: now + (60 * 60 * 1_000),
  }, secret, now);
  assert.doesNotMatch(sealed, /header|payload|signature/);

  const opened = openRecoveryCredential(sealed, secret, now + 1_000);
  assert.equal(opened.accessToken, "header.payload.signature");
  assert.equal(opened.expiresAt, now + (RECOVERY_MAX_AGE_SECONDS * 1_000));

  const parts = sealed.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  const tampered = parts.join(".");
  assert.throws(() => openRecoveryCredential(tampered, secret, now));
  assert.throws(() => openRecoveryCredential(sealed, `${secret}-wrong`, now));
  assert.throws(() => openRecoveryCredential(
    sealed,
    secret,
    now + (RECOVERY_MAX_AGE_SECONDS * 1_000) + 1,
  ));
});

test("recovery CSRF comparison and host cookie names fail closed", () => {
  const csrf = createRecoveryCsrfToken();
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(recoveryCsrfMatches(csrf, csrf), true);
  assert.equal(
    recoveryCsrfMatches(csrf, `${csrf.slice(0, -1)}${csrf.endsWith("A") ? "B" : "A"}`),
    false,
  );
  assert.equal(recoveryCsrfMatches(null, csrf), false);
  assert.equal(recoveryCookieName("production"), "__Host-sj_recovery");
  assert.equal(recoveryCookieName("development"), "sj_recovery");
  assert.equal(recoveryCookieName("production", true), "sj_recovery");
});

test("the reset browser never parses or submits Supabase recovery credentials", async () => {
  const [client, resetRoute, callback] = await Promise.all([
    readFile(new URL("../src/app/reset-password/page-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/auth/reset-password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/auth/confirm/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(client, /access_token|refresh_token|window\.location\.hash/);
  assert.match(client, /X-SJ-Recovery-CSRF/);
  assert.match(resetRoute, /openRecoveryCredential/);
  assert.match(resetRoute, /request\.headers\.get\("origin"\)/);
  assert.match(callback, /serverVerifyEmailTokenHash/);
  assert.match(callback, /httpOnly: true/);
});

test("registration requires server-confirmed email verification before onboarding", async () => {
  const [client, registerRoute] = await Promise.all([
    readFile(new URL("../src/app/register/page-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/auth/register/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(client, /signInWithConfiguredProvider/);
  assert.match(client, /Confirm your email address, then sign in/);
  assert.match(registerRoute, /verificationRequired: true/);
  assert.match(registerRoute, /request\.headers\.get\("origin"\)/);
});

test("new server Auth flows require a publishable key without legacy fallback", async () => {
  const source = await readFile(
    new URL("../src/lib/auth/server-supabase.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /process\.env\.SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.abort/);
  assert.match(source, /MAX_AUTH_RESPONSE_BYTES/);
  assert.doesNotMatch(source, /response\.json\(/);
});

test("forgot-password responses are generic across malformed, unknown, and upstream-failure cases", async () => {
  const source = await readFile(
    new URL("../src/app/api/auth/forgot-password/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /function genericResponse/);
  assert.match(source, /serverSendPasswordReset[\s\S]*\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(source, /error\.message|Email is required|Failed to send reset email/);
});
