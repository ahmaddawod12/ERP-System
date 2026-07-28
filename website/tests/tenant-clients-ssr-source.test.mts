import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/clients/page.tsx");
const clientsList = readSource("../src/components/clients/clients-list.tsx");
const clientsFilters = readSource("../src/components/clients/clients-filters.tsx");
const mutationControls = [
  readSource("../src/components/clients/client-create-control.tsx"),
  readSource("../src/components/clients/client-row-actions.tsx"),
  readSource("../src/components/clients/client-mutation-model.ts"),
  readSource("../src/components/clients/client-mutation-feedback.tsx"),
].join("\n");
const clientsClient = readSource("../src/lib/backend/clients-client.ts");
const mutationRouteCore = readSource("../src/lib/clients/client-mutation-route-core.ts");
const workspaceShell = readSource("../src/components/layout/server-workspace-shell.tsx");
const loading = readSource("../src/app/app/c/[companyId]/clients/loading.tsx");
const errorBoundary = readSource("../src/app/app/c/[companyId]/clients/error.tsx");

test("tenant clients page renders runtime-validated initial DTOs on the server", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.doesNotMatch(clientsList, /^\s*["']use client["']/m);
  assert.doesNotMatch(clientsFilters, /^\s*["']use client["']/m);
  assert.match(clientsClient, /ClientListPageSchema/);
  assert.match(page, /clients=\{page\.items\}/);
  assert.match(clientsList, /clients\.map\(\(client\) =>/);
  assert.match(clientsList, /\{client\.name\}/);
  assert.match(clientsList, /key=\{client\.clientId\}/);
});

test("membership and resolved module access are checked before the clients request", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const moduleGate = page.indexOf('membership.enabledModules.includes("clients")');
  const clientsRequest = page.indexOf("await getCompanyClients(companyId, context.sessionToken, parsedSearch.query)");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(moduleGate, -1);
  assert.notEqual(clientsRequest, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < moduleGate);
  assert.ok(moduleGate < clientsRequest);
  assert.match(page.slice(membershipDenial, clientsRequest), /notFound\(\)/);
});

test("clients use one server-only opaque-session request and never hydrate-refetch", () => {
  assert.match(clientsClient, /^import "server-only";/);
  assert.match(clientsClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.equal((page.match(/await getCompanyClients\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|useInfiniteQuery|BACKEND_API_BASE_URL/);
  assert.doesNotMatch(clientsList, /fetch\(|useEffect|useQuery|useInfiniteQuery|SmartJobSession/);
  assert.doesNotMatch(clientsFilters, /fetch\(|useEffect|useQuery|BACKEND_API_BASE_URL|SmartJobSession/);
  assert.doesNotMatch(mutationControls, /SmartJobSession|BACKEND_API_BASE_URL|IdentityToken|Firebase/i);
});

test("the clients slice exposes search, empty, loading, error, disabled, and cursor states", () => {
  assert.match(clientsFilters, /method="get"/);
  assert.match(clientsFilters, /name="search"/);
  assert.match(page, /InvalidClientsFilterState/);
  assert.match(page, /ClientsUnavailableState/);
  assert.match(page, /error\.status === 403/);
  assert.match(clientsList, /No clients match this search/);
  assert.match(clientsList, /No clients yet/);
  assert.match(clientsList, /rel="next"/);
  assert.match(clientsList, /aria-disabled="true"/);
  assert.match(loading, /LoadingState/);
  assert.match(errorBoundary, /AppRouteError/);
  assert.match(mutationControls, /Creating\.\.\.|Saving\.\.\.|Removing\.\.\./);
  assert.match(mutationControls, /disabled=\{submitting/);
  assert.match(mutationControls, /role=\{message\.kind === "error" \? "alert" : "status"\}/);
});

test("tenant navigation exposes an entitlement-aware Clients destination", () => {
  assert.match(workspaceShell, /enabledModules\.includes\("clients"\)/);
  assert.match(workspaceShell, /\/clients`\}/);
  assert.match(workspaceShell, /activeSection === "clients"/);
  assert.match(workspaceShell, /Clients unavailable/);
});

test("client mutations stay same-origin and preserve tenant scope and concurrency", () => {
  assert.match(page, /membership\.role !== "worker"/);
  assert.match(page, /ClientCreateControl companyId=\{companyId\}/);
  assert.match(clientsList, /ClientRowActions companyId=\{companyId\} client=\{client\}/);
  assert.match(mutationControls, /`\/api\/companies\/\$\{companyId\}\/clients`/);
  assert.match(mutationControls, /`\/api\/companies\/\$\{companyId\}\/clients\/\$\{client\.clientId\}`/);
  assert.match(mutationControls, /"X-SJ-CSRF": csrfToken/);
  assert.match(mutationControls, /"Idempotency-Key": idempotencyKey/);
  assert.match(mutationControls, /entityVersion/);
  assert.match(mutationControls, /router\.refresh\(\)/);
  assert.match(mutationRouteCore, /request\.headers\.get\("origin"\) !== expectedOrigin/);
  assert.match(mutationRouteCore, /safeEqual\(csrfCookie, csrfHeader\)/);
  assert.match(mutationRouteCore, /webSessionCookieName/);
  assert.match(clientsClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
});
