import type { WorkspaceSummary } from "@smart-job/api-contracts";

export type WorkspaceEntryDecision =
  | { kind: "onboarding" }
  | { kind: "select" }
  | { kind: "workspace"; companyId: number };

export function decideWorkspaceEntry(
  workspaces: readonly WorkspaceSummary[],
): WorkspaceEntryDecision {
  if (workspaces.length === 0) {
    return { kind: "onboarding" };
  }
  if (workspaces.length === 1) {
    return { kind: "workspace", companyId: workspaces[0].companyId };
  }
  return { kind: "select" };
}

/** Accept only canonical positive public company IDs used by the HTTP contract. */
export function parsePublicCompanyId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const companyId = Number(value);
  return Number.isSafeInteger(companyId) && companyId > 0
    ? companyId
    : null;
}

export function findViewerWorkspace(
  workspaces: readonly WorkspaceSummary[],
  companyId: number,
): WorkspaceSummary | null {
  return workspaces.find((workspace) => workspace.companyId === companyId) ?? null;
}

export function isOpaqueSessionAppRoute(pathname: string): boolean {
  return pathname === "/app"
    || pathname === "/app/select-company"
    || pathname === "/app/admin"
    || pathname === "/app/upgrade"
    || /^\/app\/c\/[^/]+(?:\/|$)/.test(pathname);
}
