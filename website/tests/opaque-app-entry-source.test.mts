import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appEntry = readFileSync(
  new URL("../src/app/app/page.tsx", import.meta.url),
  "utf8",
);

test("the app entry is a server-only deterministic workspace redirect", () => {
  assert.doesNotMatch(appEntry, /^\s*["']use client["']/m);
  assert.match(appEntry, /requireWebsiteSession\("\/app"\)/);
  assert.match(appEntry, /decideWorkspaceEntry\(viewer\.workspaces\)/);
  assert.match(appEntry, /redirect\("\/onboarding"\)/);
  assert.match(appEntry, /redirect\("\/app\/select-company"\)/);
  assert.match(appEntry, /redirect\(`\/app\/c\/\$\{decision\.companyId\}`\)/);
  assert.doesNotMatch(appEntry, /AppOverviewClient|Suspense|useAuth|read-model/);
});
