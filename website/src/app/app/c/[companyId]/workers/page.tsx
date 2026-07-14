import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { Search, ShieldX, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { InvitationCreateForm } from "@/components/workers/invitation-create-form";
import { WorkersFilters } from "@/components/workers/workers-filters";
import { WorkersList } from "@/components/workers/workers-list";
import { BackendTransportError } from "@/lib/backend/transport-core";
import { getCompanyWorkers } from "@/lib/backend/workers-client";
import {
  EMPTY_WORKERS_FILTERS,
  parseWorkersSearchParams,
  type WorkersSearchParams,
} from "@/lib/dal/workers-query";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Team | Smart-Job" };

function WorkersPageFrame({
  viewer,
  workspace,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="workers">
      <section className="dashboard-page" aria-labelledby="workers-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered team directory
              </p>
              <h1 id="workers-heading" className="dashboard-title mt-4">{workspace.name} team</h1>
              <p className="dashboard-copy mt-3">
                Invite field staff and browse one bounded, tenant-scoped membership page. Search, role, status, and continuation filters execute in Postgres.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
              <Badge variant="success">Team enabled</Badge>
            </div>
          </div>
        </div>
        {children}
      </section>
    </ServerWorkspaceShell>
  );
}

function WorkersUnavailableState({
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
    <WorkersPageFrame viewer={viewer} workspace={workspace}>
      <WorkersFilters companyId={workspace.companyId} filters={EMPTY_WORKERS_FILTERS} disabled />
      <EmptyState
        title={title}
        description={description}
        action={(
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            <ShieldX className="h-4 w-4" aria-hidden="true" />
            Team controls disabled
          </span>
        )}
      />
    </WorkersPageFrame>
  );
}

function InvalidWorkersFilterState({ message }: { message: string }) {
  return (
    <Card className="border-red-200 dark:border-red-900/70">
      <div role="alert" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <Search className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Check the team filters</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export default async function CompanyWorkersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<WorkersSearchParams>;
}) {
  const [{ companyId: rawCompanyId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/workers`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // Reject forged tenant URLs, disabled Team subscriptions, and non-manager
  // roles before requesting company-scoped membership data.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  if (!membership.enabledModules.includes("team")) {
    return (
      <WorkersUnavailableState
        viewer={viewer}
        workspace={membership}
        title="Team management is unavailable"
        description="This workspace does not have an active Team entitlement. Directory filters and invitations remain disabled until access changes."
      />
    );
  }

  if (membership.role !== "manager" && membership.role !== "dev") {
    return (
      <WorkersUnavailableState
        viewer={viewer}
        workspace={membership}
        title="Manager access is required"
        description="Only workspace managers and system developers can view the company team or create invitations."
      />
    );
  }

  const parsedSearch = parseWorkersSearchParams(rawSearchParams);
  if (!parsedSearch.ok) {
    return (
      <WorkersPageFrame viewer={viewer} workspace={membership}>
        <InvitationCreateForm companyId={companyId} />
        <WorkersFilters companyId={companyId} filters={parsedSearch.filters} />
        <InvalidWorkersFilterState message={parsedSearch.message} />
      </WorkersPageFrame>
    );
  }

  let page;
  try {
    page = await getCompanyWorkers(companyId, context.sessionToken, parsedSearch.query);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && error.status === 403) {
      return (
        <WorkersUnavailableState
          viewer={viewer}
          workspace={membership}
          title="Team management is unavailable"
          description="The backend did not find an active manager role and Team entitlement for this workspace."
        />
      );
    }
    if (error instanceof BackendTransportError && error.status === 404) {
      notFound();
    }
    if (error instanceof BackendTransportError && error.status === 400) {
      return (
        <WorkersPageFrame viewer={viewer} workspace={membership}>
          <InvitationCreateForm companyId={companyId} />
          <WorkersFilters companyId={companyId} filters={parsedSearch.filters} />
          <InvalidWorkersFilterState message="The pagination cursor or team filters are no longer valid. Return to the first page and try again." />
        </WorkersPageFrame>
      );
    }
    throw error;
  }

  return (
    <WorkersPageFrame viewer={viewer} workspace={membership}>
      <InvitationCreateForm companyId={companyId} />
      <WorkersFilters companyId={companyId} filters={parsedSearch.filters} />
      <WorkersList
        companyId={companyId}
        workers={page.items}
        filters={parsedSearch.filters}
        afterCursor={parsedSearch.afterCursor}
        nextCursor={page.nextCursor}
      />
    </WorkersPageFrame>
  );
}
