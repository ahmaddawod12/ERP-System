import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/workers/page.tsx");
const workersList = readSource("../src/components/workers/workers-list.tsx");
const workerActions = readSource("../src/components/workers/worker-membership-actions.tsx");
const workersFilters = readSource("../src/components/workers/workers-filters.tsx");
const invitationForm = readSource("../src/components/workers/invitation-create-form.tsx");
const workersClient = readSource("../src/lib/backend/workers-client.ts");
const invitationClient = readSource("../src/lib/backend/invitation-client.ts");
const invitationRoute = readSource("../src/lib/workers/invitation-create-route-core.ts");
const workersQuery = readSource("../src/lib/dal/workers-query.ts");
const workspaceShell = readSource("../src/components/layout/server-workspace-shell.tsx");
const loading = readSource("../src/app/app/c/[companyId]/workers/loading.tsx");
const errorBoundary = readSource("../src/app/app/c/[companyId]/workers/error.tsx");

test("tenant workers render one runtime-validated initial page on the server", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.doesNotMatch(workersList, /^\s*["']use client["']/m);
  assert.doesNotMatch(workersFilters, /^\s*["']use client["']/m);
  assert.match(workersClient, /WorkerListPageSchema/);
  assert.match(page, /workers=\{page\.items\}/);
  assert.match(workersList, /workers\.map\(\(worker\) =>/);
  assert.match(workersList, /key=\{worker\.memberNo\}/);
});

test("membership, Team entitlement, and manager role are checked before the worker request", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const moduleGate = page.indexOf('membership.enabledModules.includes("team")');
  const roleGate = page.indexOf('membership.role !== "manager" && membership.role !== "dev"');
  const workersRequest = page.indexOf("await getCompanyWorkers(");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(moduleGate, -1);
  assert.notEqual(roleGate, -1);
  assert.notEqual(workersRequest, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < moduleGate);
  assert.ok(moduleGate < roleGate);
  assert.ok(roleGate < workersRequest);
  assert.match(page.slice(membershipDenial, workersRequest), /notFound\(\)/);
});

test("the team directory uses one server-only opaque-session read", () => {
  assert.match(workersClient, /^import "server-only";/);
  assert.match(workersClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.equal((page.match(/await getCompanyWorkers\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|useInfiniteQuery|BACKEND_API_BASE_URL/);
  assert.doesNotMatch(workersList, /fetch\(|useEffect|useQuery|SmartJobSession/);
  assert.doesNotMatch(workersFilters, /fetch\(|useEffect|useQuery|SmartJobSession/);
  assert.match(workersQuery, /pageSize: WEBSITE_WORKERS_PAGE_SIZE/);
});

test("worker states cover filters, empty, loading, error, disabled, and cursor continuation", () => {
  assert.match(workersFilters, /method="get"/);
  assert.match(workersFilters, /name="search"/);
  assert.match(workersFilters, /name="role"/);
  assert.match(workersFilters, /name="status"/);
  assert.match(page, /InvalidWorkersFilterState/);
  assert.match(page, /WorkersUnavailableState/);
  assert.match(page, /error\.status === 403/);
  assert.match(workersList, /No team members match these filters/);
  assert.match(workersList, /No team members yet/);
  assert.match(workersList, /rel="next"/);
  assert.match(workersList, /aria-disabled="true"/);
  assert.match(loading, /LoadingState/);
  assert.match(errorBoundary, /AppRouteError/);
});

test("invitation creation crosses only the same-origin CSRF-protected BFF", () => {
  assert.match(invitationForm, /^"use client";/);
  assert.match(invitationForm, /fetch\("\/api\/workers\/invitation"/);
  assert.match(invitationForm, /readCookie\(document\.cookie, WEB_CSRF_COOKIE\)/);
  assert.match(invitationForm, /"X-SJ-CSRF": csrfToken/);
  assert.match(invitationForm, /"Idempotency-Key": idempotencyKey/);
  assert.match(invitationForm, /useRef<PendingIdentity \| null>\(null\)/);
  assert.match(invitationForm, /pendingIdentity\.current\?\.fingerprint !== fingerprint/);
  assert.doesNotMatch(invitationForm, /SmartJobSession|accessToken|refreshToken|localStorage|sessionStorage/);

  assert.match(invitationRoute, /request\.headers\.get\("origin"\) === expectedOrigin/);
  assert.match(invitationRoute, /safeEqual\(csrfCookie, csrfHeader\)/);
  assert.match(invitationClient, /^import "server-only";/);
  assert.match(invitationClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
});

test("tenant navigation exposes Team only with entitlement and manager/dev role", () => {
  assert.match(workspaceShell, /enabledModules\.includes\("team"\)/);
  assert.match(workspaceShell, /workspace\.role === "manager" \|\| workspace\.role === "dev"/);
  assert.match(workspaceShell, /\/workers/);
  assert.match(workspaceShell, /activeSection === "workers"/);
  assert.match(workspaceShell, /Team unavailable/);
});

test("team mutations use the same-origin BFF with versions and retry-stable identities", () => {
  assert.match(workersList, /WorkerMembershipActions/);
  assert.match(workerActions, /^"use client";/);
  assert.match(workerActions, /fetch\("\/api\/workers\/membership"/);
  assert.match(workerActions, /entityVersion: current\.entityVersion/);
  assert.match(workerActions, /"Idempotency-Key": pendingIdentity\.current\.key/);
  assert.match(workerActions, /"X-SJ-CSRF": csrfToken/);
  assert.match(workerActions, /router\.refresh\(\)/);
  assert.match(workerActions, /Active jobs and remaining inventory must be cleared first/);
  assert.doesNotMatch(workerActions, /SmartJobSession|accessToken|refreshToken|localStorage|sessionStorage|manageWorker/);
});
