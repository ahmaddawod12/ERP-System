import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("tenant upgrade is server-routed and submits through the opaque same-origin BFF", () => {
  const page = read("src/app/app/c/[companyId]/upgrade/page.tsx");
  const form = read("src/components/upgrade/upgrade-request-form.tsx");
  const shell = read("src/components/layout/server-workspace-shell.tsx");
  assert.doesNotMatch(page, /["']use client["']/u);
  assert.match(page, /requireWebsiteRequestContext/u);
  assert.match(page, /findViewerWorkspace/u);
  assert.match(form, /fetch\("\/api\/upgrade-requests"/u);
  assert.match(form, /X-SJ-CSRF/u);
  assert.match(form, /Idempotency-Key/u);
  assert.match(shell, /\/upgrade/u);
});

test("admin queue is server-rendered and developer authority stays in the API", () => {
  const page = read("src/app/app/admin/page.tsx");
  const controls = read("src/components/upgrade/upgrade-moderation-controls.tsx");
  assert.doesNotMatch(page, /["']use client["']/u);
  assert.match(page, /listUpgradeRequests/u);
  assert.match(page, /requireWebsiteRequestContext/u);
  assert.doesNotMatch(page, /buildAuthedJsonHeaders|\/api\/callable/u);
  assert.match(controls, /entityVersion/u);
  assert.match(controls, /\/api\/upgrade-requests/u);
  assert.match(controls, /router\.refresh/u);
});
