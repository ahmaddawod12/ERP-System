import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginClient = readFileSync(
  new URL("../src/app/login/page-client.tsx", import.meta.url),
  "utf8",
);

test("login establishes an opaque same-origin session without browser auth SDKs", () => {
  assert.match(loginClient, /fetch\("\/api\/auth\/login"/);
  assert.match(loginClient, /credentials: "include"/);
  assert.match(loginClient, /loginResponseSchema\.safeParse/);
  assert.match(loginClient, /workspaceDestination\(parsed\.data\.data\.viewer\.workspaces\)/);
  assert.doesNotMatch(
    loginClient,
    /signInWithConfiguredProvider|client-auth|NEXT_PUBLIC_SUPABASE|localStorage|sessionStorage|access[_-]?token|refresh[_-]?token|Authorization/i,
  );
});

test("post-login redirects accept only opaque-session routes", () => {
  assert.match(loginClient, /value === "\/onboarding"/);
  assert.match(loginClient, /value === "\/app\/select-company"/);
  assert.match(loginClient, /\^\\\/app\\\/c\\\//);
  assert.doesNotMatch(loginClient, /startsWith\("\/"\)/);
});
