import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/inventory/page.tsx");
const inventoryList = readSource("../src/components/inventory/inventory-list.tsx");
const inventoryFilters = readSource("../src/components/inventory/inventory-filters.tsx");
const inventoryCreate = readSource("../src/components/inventory/inventory-create-control.tsx");
const inventoryActions = readSource("../src/components/inventory/inventory-row-actions.tsx");
const inventoryMutationModel = readSource("../src/components/inventory/inventory-mutation-model.ts");
const inventoryMutationRoute = readSource("../src/lib/inventory/inventory-mutation-route-core.ts");
const inventoryClient = readSource("../src/lib/backend/inventory-client.ts");
const inventoryQuery = readSource("../src/lib/dal/inventory-query.ts");
const workspaceShell = readSource("../src/components/layout/server-workspace-shell.tsx");
const loading = readSource("../src/app/app/c/[companyId]/inventory/loading.tsx");
const errorBoundary = readSource("../src/app/app/c/[companyId]/inventory/error.tsx");

test("tenant inventory renders runtime-validated initial DTOs on the server", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.doesNotMatch(inventoryList, /^\s*["']use client["']/m);
  assert.doesNotMatch(inventoryFilters, /^\s*["']use client["']/m);
  assert.match(inventoryClient, /InventoryListPageSchema/);
  assert.match(page, /parts=\{page\.items\}/);
  assert.match(inventoryList, /parts\.map\(\(part\) =>/);
  assert.match(inventoryList, /\{part\.name\}/);
  assert.match(inventoryList, /key=\{part\.partId\}/);
});

test("membership, module, and role scope are checked before inventory requests", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const moduleGate = page.indexOf('membership.enabledModules.includes("inventory")');
  const roleGate = page.indexOf("resolveInventoryReadScope(membership.role)");
  const inventoryRequest = page.indexOf("await getWorkspaceInventory(");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(moduleGate, -1);
  assert.notEqual(roleGate, -1);
  assert.notEqual(inventoryRequest, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < moduleGate);
  assert.ok(moduleGate < roleGate);
  assert.ok(roleGate < inventoryRequest);
  assert.match(page.slice(membershipDenial, inventoryRequest), /notFound\(\)/);
});

test("the one server-only request selects company or assigned stock by role", () => {
  assert.match(page, /role === "worker"\) return "member"/);
  assert.match(page, /role === "manager" \|\| role === "user" \|\| role === "dev"/);
  assert.match(inventoryQuery, /scope === "member" \? "\/me" : ""/);
  assert.match(inventoryClient, /^import "server-only";/);
  assert.match(inventoryClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.equal((page.match(/await getWorkspaceInventory\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|useInfiniteQuery|BACKEND_API_BASE_URL/);
  assert.doesNotMatch(inventoryList, /fetch\(|useEffect|useQuery|useInfiniteQuery|SmartJobSession/);
  assert.doesNotMatch(inventoryFilters, /fetch\(|useEffect|useQuery|BACKEND_API_BASE_URL|SmartJobSession/);
});

test("inventory exposes filter, empty, loading, error, disabled, and cursor states", () => {
  assert.match(inventoryFilters, /method="get"/);
  assert.match(inventoryFilters, /name="search"/);
  assert.match(inventoryFilters, /name="status"/);
  assert.match(page, /InvalidInventoryFilterState/);
  assert.match(page, /InventoryUnavailableState/);
  assert.match(page, /error\.status === 403/);
  assert.match(inventoryList, /No parts match these filters/);
  assert.match(inventoryList, /No inventory parts yet/);
  assert.match(inventoryList, /rel="next"/);
  assert.match(inventoryList, /aria-disabled="true"/);
  assert.match(loading, /LoadingState/);
  assert.match(errorBoundary, /AppRouteError/);
});

test("tenant navigation exposes an entitlement and role-aware Inventory destination", () => {
  assert.match(workspaceShell, /enabledModules\.includes\("inventory"\)/);
  assert.match(workspaceShell, /workspace\.role !== "basic"/);
  assert.match(workspaceShell, /\/inventory`\}/);
  assert.match(workspaceShell, /activeSection === "inventory"/);
  assert.match(workspaceShell, /Inventory unavailable/);
});

test("manager inventory controls remain thin client islands over the opaque-session BFF", () => {
  assert.match(page, /membership\.role === "manager" \|\| membership\.role === "dev"/);
  assert.match(page, /<InventoryCreateControl/);
  assert.match(inventoryList, /<InventoryRowActions/);
  assert.match(inventoryCreate, /^"use client";/);
  assert.match(inventoryActions, /^"use client";/);
  assert.match(inventoryMutationModel, /X-SJ-CSRF/);
  assert.match(inventoryMutationModel, /Idempotency-Key/);
  assert.match(inventoryMutationModel, /crypto\.randomUUID\(\)/);
  assert.match(inventoryMutationRoute, /request\.headers\.get\("origin"\) !== expectedOrigin/);
  assert.match(inventoryMutationRoute, /SmartJobSession|isOpaqueSessionToken/);
  assert.match(inventoryActions, /stockEntityVersion/);
  assert.match(inventoryActions, /entityVersion/);
  assert.match(inventoryActions, /router\.refresh\(\)/);
  assert.doesNotMatch(`${page}\n${inventoryList}`, /^\s*["']use client["']/m);
  assert.doesNotMatch(`${inventoryCreate}\n${inventoryActions}`, /BACKEND_API_BASE_URL|SmartJobSession/);
});
