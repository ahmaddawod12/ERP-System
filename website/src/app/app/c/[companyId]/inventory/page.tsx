import { Package, Search, ShieldX } from "lucide-react";
import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { notFound, redirect } from "next/navigation";
import { InventoryCreateControl } from "@/components/inventory/inventory-create-control";
import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { InventoryList } from "@/components/inventory/inventory-list";
import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getWorkspaceInventory } from "@/lib/backend/inventory-client";
import { BackendTransportError } from "@/lib/backend/transport-core";
import {
  parseInventorySearchParams,
  type InventoryFilterValues,
  type InventoryReadScope,
  type InventorySearchParams,
} from "@/lib/dal/inventory-query";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Inventory | Smart-Job" };

const emptyFilters: InventoryFilterValues = { status: "", search: "" };

function resolveInventoryReadScope(role: WorkspaceSummary["role"]): InventoryReadScope | null {
  if (role === "worker") return "member";
  if (role === "manager" || role === "user" || role === "dev") return "company";
  return null;
}

function InventoryPageFrame({
  viewer,
  workspace,
  scope,
  editable = false,
  actions,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  scope: InventoryReadScope | null;
  editable?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMemberScope = scope === "member";
  const isCompanyScope = scope === "company";

  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="inventory">
      <section className="dashboard-page" aria-labelledby="inventory-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Package className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered inventory
              </p>
              <h1 id="inventory-heading" className="dashboard-title mt-4">
                {isMemberScope ? "Your assigned inventory" : `${workspace.name} inventory`}
              </h1>
              <p className="dashboard-copy mt-3">
                {isMemberScope
                  ? "Review the bounded, tenant-scoped stock assigned to your membership. Search and status filters run in the backend database."
                  : isCompanyScope
                    ? "Review bounded company stock without loading the full inventory collection. Search, status filters, and pagination run in the backend database."
                    : "Inventory access is currently unavailable for this workspace or membership."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
              <Badge variant={isMemberScope ? "warning" : isCompanyScope ? "success" : "default"}>
                {isMemberScope ? "Assigned stock" : isCompanyScope ? "Company stock" : "Access unavailable"}
              </Badge>
              <Badge variant={editable ? "success" : "warning"}>
                {editable ? "Inventory management enabled" : "Read only"}
              </Badge>
              {actions}
            </div>
          </div>
        </div>
        {children}
      </section>
    </ServerWorkspaceShell>
  );
}

function InventoryUnavailableState({
  viewer,
  workspace,
  title,
  description,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  title: string;
  description: string;
}) {
  return (
    <InventoryPageFrame
      viewer={viewer}
      workspace={workspace}
      scope={resolveInventoryReadScope(workspace.role)}
    >
      <InventoryFilters companyId={workspace.companyId} filters={emptyFilters} disabled />
      <EmptyState
        title={title}
        description={description}
        action={(
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            <ShieldX className="h-4 w-4" aria-hidden="true" />
            Inventory unavailable
          </span>
        )}
      />
    </InventoryPageFrame>
  );
}

function InvalidInventoryFilterState({ message }: { message: string }) {
  return (
    <Card className="border-red-200 dark:border-red-900/70">
      <div role="alert" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <Search className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Check the inventory filters</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export default async function CompanyInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<InventorySearchParams>;
}) {
  const [{ companyId: rawCompanyId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/inventory`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // Resolve the current server-side membership, module entitlement, and role
  // scope before performing any company-scoped inventory request.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  if (!membership.enabledModules.includes("inventory")) {
    return (
      <InventoryUnavailableState
        viewer={viewer}
        workspace={membership}
        title="Inventory is unavailable for this workspace"
        description="This subscription does not currently enable inventory. Search and pagination remain disabled until access changes."
      />
    );
  }

  const scope = resolveInventoryReadScope(membership.role);
  if (!scope) {
    return (
      <InventoryUnavailableState
        viewer={viewer}
        workspace={membership}
        title="Inventory is unavailable for your role"
        description="This membership cannot read company or assigned inventory. Ask a workspace manager if you need access."
      />
    );
  }

  const canManageInventory = scope === "company"
    && (membership.role === "manager" || membership.role === "dev");
  const inventoryActions = canManageInventory
    ? <InventoryCreateControl companyId={companyId} />
    : undefined;

  const parsedSearch = parseInventorySearchParams(rawSearchParams);
  if (!parsedSearch.ok) {
    return (
      <InventoryPageFrame
        viewer={viewer}
        workspace={membership}
        scope={scope}
        editable={canManageInventory}
        actions={inventoryActions}
      >
        <InventoryFilters companyId={companyId} filters={parsedSearch.filters} />
        <InvalidInventoryFilterState message={parsedSearch.message} />
      </InventoryPageFrame>
    );
  }

  let page;
  try {
    page = await getWorkspaceInventory(
      companyId,
      context.sessionToken,
      scope,
      parsedSearch.query,
    );
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && error.status === 403) {
      return (
        <InventoryUnavailableState
          viewer={viewer}
          workspace={membership}
          title="Inventory access is no longer available"
          description="Your role or workspace entitlement changed while this page was loading. Refresh your workspace access before trying again."
        />
      );
    }
    if (error instanceof BackendTransportError && error.status === 404) {
      notFound();
    }
    if (error instanceof BackendTransportError && error.status === 400) {
      return (
        <InventoryPageFrame
          viewer={viewer}
          workspace={membership}
          scope={scope}
          editable={canManageInventory}
          actions={inventoryActions}
        >
          <InventoryFilters companyId={companyId} filters={parsedSearch.filters} />
          <InvalidInventoryFilterState message="The pagination cursor or inventory filters are no longer valid. Return to the first page and try again." />
        </InventoryPageFrame>
      );
    }
    throw error;
  }

  return (
    <InventoryPageFrame
      viewer={viewer}
      workspace={membership}
      scope={scope}
      editable={canManageInventory}
      actions={inventoryActions}
    >
      <InventoryFilters companyId={companyId} filters={parsedSearch.filters} />
      <InventoryList
        companyId={companyId}
        scope={scope}
        parts={page.items}
        filters={parsedSearch.filters}
        afterCursor={parsedSearch.afterCursor}
        nextCursor={page.nextCursor}
        canManageInventory={canManageInventory}
      />
    </InventoryPageFrame>
  );
}
