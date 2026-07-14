import { Search, ShieldX, UsersRound } from "lucide-react";
import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { notFound, redirect } from "next/navigation";
import { ClientCreateControl } from "@/components/clients/client-create-control";
import { ClientsFilters } from "@/components/clients/clients-filters";
import { ClientsList } from "@/components/clients/clients-list";
import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCompanyClients } from "@/lib/backend/clients-client";
import { BackendTransportError } from "@/lib/backend/transport-core";
import {
  parseClientsSearchParams,
  type ClientsFilterValues,
  type ClientsSearchParams,
} from "@/lib/dal/clients-query";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Clients | Smart-Job" };

const emptyFilters: ClientsFilterValues = { search: "" };

function ClientsPageFrame({
  viewer,
  workspace,
  editable = false,
  actions,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  editable?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="clients">
      <section className="dashboard-page" aria-labelledby="clients-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered client directory
              </p>
              <h1 id="clients-heading" className="dashboard-title mt-4">{workspace.name} clients</h1>
              <p className="dashboard-copy mt-3">
                Browse a bounded page of tenant-scoped client records. Search and pagination execute in the backend database.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
              <Badge variant={editable ? "success" : "warning"}>
                {editable ? "Client management enabled" : "Read only"}
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

function ClientsUnavailableState({
  viewer,
  workspace,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
}) {
  return (
    <ClientsPageFrame viewer={viewer} workspace={workspace}>
      <ClientsFilters companyId={workspace.companyId} filters={emptyFilters} disabled />
      <EmptyState
        title="Clients are unavailable for this workspace"
        description="This subscription does not currently enable the clients module. Search and pagination remain disabled until access changes."
        action={(
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            <ShieldX className="h-4 w-4" aria-hidden="true" />
            Module disabled
          </span>
        )}
      />
    </ClientsPageFrame>
  );
}

function InvalidClientsFilterState({ message }: { message: string }) {
  return (
    <Card className="border-red-200 dark:border-red-900/70">
      <div role="alert" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <Search className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Check the client search</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export default async function CompanyClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<ClientsSearchParams>;
}) {
  const [{ companyId: rawCompanyId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/clients`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // Reject forged tenant URLs and disabled modules before making any
  // company-scoped client request.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  if (!membership.enabledModules.includes("clients")) {
    return <ClientsUnavailableState viewer={viewer} workspace={membership} />;
  }

  const canManageClients = membership.role !== "worker";
  const clientActions = canManageClients
    ? <ClientCreateControl companyId={companyId} />
    : undefined;

  const parsedSearch = parseClientsSearchParams(rawSearchParams);
  if (!parsedSearch.ok) {
    return (
      <ClientsPageFrame
        viewer={viewer}
        workspace={membership}
        editable={canManageClients}
        actions={clientActions}
      >
        <ClientsFilters companyId={companyId} filters={parsedSearch.filters} />
        <InvalidClientsFilterState message={parsedSearch.message} />
      </ClientsPageFrame>
    );
  }

  let page;
  try {
    page = await getCompanyClients(companyId, context.sessionToken, parsedSearch.query);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && error.status === 403) {
      return <ClientsUnavailableState viewer={viewer} workspace={membership} />;
    }
    if (error instanceof BackendTransportError && error.status === 404) {
      notFound();
    }
    if (error instanceof BackendTransportError && error.status === 400) {
      return (
        <ClientsPageFrame
          viewer={viewer}
          workspace={membership}
          editable={canManageClients}
          actions={clientActions}
        >
          <ClientsFilters companyId={companyId} filters={parsedSearch.filters} />
          <InvalidClientsFilterState message="The pagination cursor or client search is no longer valid. Return to the first page and try again." />
        </ClientsPageFrame>
      );
    }
    throw error;
  }

  return (
    <ClientsPageFrame
      viewer={viewer}
      workspace={membership}
      editable={canManageClients}
      actions={clientActions}
    >
      <ClientsFilters companyId={companyId} filters={parsedSearch.filters} />
      <ClientsList
        companyId={companyId}
        clients={page.items}
        filters={parsedSearch.filters}
        afterCursor={parsedSearch.afterCursor}
        nextCursor={page.nextCursor}
        canManageClients={canManageClients}
      />
    </ClientsPageFrame>
  );
}
