import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/settings/page.tsx");
const viewerForm = readSource("../src/components/settings/viewer-profile-form.tsx");
const companyForm = readSource("../src/components/settings/company-profile-form.tsx");
const profileClient = readSource("../src/lib/backend/profile-client.ts");
const profileRoute = readSource("../src/lib/settings/profile-route-core.ts");
const workspaceShell = readSource("../src/components/layout/server-workspace-shell.tsx");
const loading = readSource("../src/app/app/c/[companyId]/settings/loading.tsx");
const errorBoundary = readSource("../src/app/app/c/[companyId]/settings/error.tsx");

test("tenant settings render both runtime-validated profiles before hydration", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.match(profileClient, /^import "server-only";/);
  assert.match(profileClient, /ViewerProfileSchema/);
  assert.match(profileClient, /BusinessProfileSchema/);
  assert.match(page, /ProfileServerSummary/);
  assert.match(page, /viewerProfile\.email/);
  assert.match(page, /businessProfile\.vatNumber/);
  assert.doesNotMatch(page, /viewerProfile\.uid/);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|BACKEND_API_BASE_URL/);
});

test("membership is checked before two independent server-only profile reads", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const parallelRead = page.indexOf("await Promise.all([");
  const viewerRead = page.indexOf("getViewerProfile(companyId, context.sessionToken)");
  const companyRead = page.indexOf("getCompanyProfile(companyId, context.sessionToken)");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(parallelRead, -1);
  assert.notEqual(viewerRead, -1);
  assert.notEqual(companyRead, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < parallelRead);
  assert.ok(parallelRead < viewerRead);
  assert.ok(parallelRead < companyRead);
  assert.match(page.slice(membershipDenial, parallelRead), /notFound\(\)/);
  assert.match(profileClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
});

test("settings mutations cross only exact-origin CSRF-protected opaque BFFs", () => {
  for (const form of [viewerForm, companyForm]) {
    assert.match(form, /^"use client";/);
    assert.match(form, /readCookie\(document\.cookie, WEB_CSRF_COOKIE\)/);
    assert.match(form, /"X-SJ-CSRF": csrfToken/);
    assert.match(form, /"Idempotency-Key": idempotencyKey/);
    assert.match(form, /useState<PendingIdentity \| null>\(null\)/);
    assert.match(form, /pendingIdentity\?\.fingerprint === fingerprint/);
    assert.doesNotMatch(form, /SmartJobSession|accessToken|refreshToken|localStorage|sessionStorage/);
  }

  assert.match(viewerForm, /fetch\("\/api\/settings\/profile"/);
  assert.match(companyForm, /fetch\("\/api\/settings\/company-profile"/);
  assert.match(profileRoute, /request\.headers\.get\("origin"\) === expectedOrigin/);
  assert.match(profileRoute, /safeEqual\(csrfCookie, csrfHeader\)/);
  assert.match(profileRoute, /ViewerProfileSchema\.parse\(candidate\)/);
  assert.match(profileRoute, /BusinessProfileSchema\.parse\(candidate\)/);
});

test("RHF forms use useWatch and company VAT remains immutable", () => {
  for (const form of [viewerForm, companyForm]) {
    assert.match(form, /useForm/);
    assert.match(form, /useWatch/);
    assert.doesNotMatch(form, /\bwatch\s*\(/);
  }

  assert.match(companyForm, /BusinessProfileUpdateRequestSchema/);
  assert.match(companyForm, /useState<EntityVersion>\(initial\.entityVersion\)/);
  assert.match(viewerForm, /dirtyFields\.displayName/);
  assert.match(companyForm, /dirtyFields\.businessEmail/);
  assert.doesNotMatch(companyForm, /defaultValues:\s*initial/);
  assert.match(companyForm, /STALE_ENTITY_VERSION/);
  assert.match(companyForm, /router\.refresh\(\)/);
  assert.doesNotMatch(companyForm, /register\("vatNumber"\)/);
  assert.doesNotMatch(companyForm, /vatNumber\s*:/);
  assert.match(page, /Immutable after onboarding/);
  assert.match(page, /key=\{businessProfile\.entityVersion\}/);
});

test("settings expose loading, error, empty, disabled, read-only, conflict, and success states", () => {
  assert.match(loading, /LoadingState/);
  assert.match(errorBoundary, /AppRouteError/);
  assert.match(page, /SettingsUnavailable/);
  assert.match(page, /EmptyProfileNotice/);
  assert.match(page, /personalProfileEmpty/);
  assert.match(page, /companyProfileEmpty/);
  assert.match(page, /canEditCompany/);
  assert.match(companyForm, /Read-only for your role/);
  assert.match(companyForm, /Company profile locked/);
  assert.match(companyForm, /kind: "conflict"/);
  assert.match(companyForm, /kind: "success"/);
  assert.match(viewerForm, /kind: "success"/);
});

test("workspace navigation exposes Settings while preserving the Team entitlement gate", () => {
  assert.match(workspaceShell, /activeSection === "settings"/);
  assert.match(workspaceShell, /\/settings/);
  assert.match(workspaceShell, /enabledModules\.includes\("team"\)/);
  assert.match(workspaceShell, /workspace\.role === "manager" \|\| workspace\.role === "dev"/);
  assert.match(workspaceShell, /Team unavailable/);
});
