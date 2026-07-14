import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const companyPage = readFileSync(
  new URL("../src/app/app/c/[companyId]/page.tsx", import.meta.url),
  "utf8",
);
const selectionPage = readFileSync(
  new URL("../src/app/app/select-company/page.tsx", import.meta.url),
  "utf8",
);
const workspaceClient = readFileSync(
  new URL("../src/lib/backend/workspace-client.ts", import.meta.url),
  "utf8",
);
const middleware = readFileSync(
  new URL("../proxy.ts", import.meta.url),
  "utf8",
);
const opaqueLogout = readFileSync(
  new URL("../src/components/auth/opaque-session-logout.tsx", import.meta.url),
  "utf8",
);

test("new tenant pages remain Server Components", () => {
  assert.doesNotMatch(companyPage, /^\s*["']use client["']/m);
  assert.doesNotMatch(selectionPage, /^\s*["']use client["']/m);
});

test("overview enforces current membership before requesting tenant data", () => {
  const membershipCheck = companyPage.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const bootstrapRequest = companyPage.indexOf("await getCompanyBootstrap(companyId, context.sessionToken)");
  assert.notEqual(membershipCheck, -1);
  assert.notEqual(bootstrapRequest, -1);
  assert.ok(membershipCheck < bootstrapRequest);
  assert.match(companyPage, /if \(!membership\) \{\s*notFound\(\);/);
});

test("server-only workspace transport validates the shared contract and uses opaque auth", () => {
  assert.match(workspaceClient, /import "server-only"/);
  assert.match(workspaceClient, /CompanyBootstrapSchema/);
  assert.match(workspaceClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.match(workspaceClient, /result\.data\.workspace\.companyId !== companyId/);
});

test("workspace selection sends zero memberships to onboarding and auto-selects one", () => {
  assert.match(selectionPage, /decision\.kind === "onboarding"[\s\S]*redirect\("\/onboarding"\)/);
  assert.match(selectionPage, /decision\.kind === "workspace"[\s\S]*redirect\(`\/app\/c\/\$\{decision\.companyId\}`\)/);
});

test("proxy recognizes opaque sessions on the entry and explicit-tenant slices", () => {
  assert.match(middleware, /if \(isOpaqueSessionAppRoute\(request\.nextUrl\.pathname\)\)/);
  assert.match(middleware, /request\.cookies\.get\(webSessionCookieName\(\)\)/);
  assert.match(middleware, /if \(isOpaqueSessionToken\(opaqueToken\)\)/);
  assert.match(middleware, /const hasValidToken = await hasValidRevocationCheckedSession/);
});

test("tenant shell logout uses only the readable CSRF cookie", () => {
  assert.match(opaqueLogout, /readCookie\(document\.cookie, WEB_CSRF_COOKIE\)/);
  assert.match(opaqueLogout, /fetch\("\/api\/auth\/logout"/);
  assert.match(opaqueLogout, /"X-SJ-CSRF": csrfToken/);
  assert.doesNotMatch(opaqueLogout, /localStorage|sessionStorage|sj_web_session|__Host-sj_web_session/);
});
