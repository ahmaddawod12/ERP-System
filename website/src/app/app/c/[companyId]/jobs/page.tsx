import { BriefcaseBusiness, Filter, ShieldX } from "lucide-react";
import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { notFound, redirect } from "next/navigation";
import { JobsFilters } from "@/components/jobs/jobs-filters";
import { JobsList } from "@/components/jobs/jobs-list";
import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/states/empty-state";
import { getCompanyJobs } from "@/lib/backend/jobs-client";
import { BackendTransportError } from "@/lib/backend/transport-core";
import {
  parseJobsSearchParams,
  type JobsFilterValues,
  type JobsSearchParams,
} from "@/lib/dal/jobs-query";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Jobs | Smart-Job" };

const emptyFilters: JobsFilterValues = {
  status: "",
  search: "",
  dateFrom: "",
  dateTo: "",
};

function JobsPageFrame({
  viewer,
  workspace,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="jobs">
      <section className="dashboard-page" aria-labelledby="jobs-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered job queue
              </p>
              <h1 id="jobs-heading" className="dashboard-title mt-4">{workspace.name} jobs</h1>
              <p className="dashboard-copy mt-3">
                Browse a bounded, role-aware page of jobs. Filters and pagination execute in the backend database.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
            </div>
          </div>
        </div>
        {children}
      </section>
    </ServerWorkspaceShell>
  );
}

function InvalidJobsFilterState({ message }: { message: string }) {
  return (
    <Card className="border-red-200 dark:border-red-900/70">
      <div role="alert" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <Filter className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Check the job filters</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export default async function CompanyJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<JobsSearchParams>;
}) {
  const [{ companyId: rawCompanyId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/jobs`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // The URL tenant must be present in the current server-resolved memberships
  // before this page performs any company-scoped backend request.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  if (!membership.enabledModules.includes("solojob")) {
    return (
      <JobsPageFrame viewer={viewer} workspace={membership}>
        <JobsFilters companyId={companyId} filters={emptyFilters} disabled />
        <EmptyState
          title="Jobs are unavailable for this workspace"
          description="This subscription does not currently enable the jobs module. Filtering and pagination remain disabled until access changes."
          action={(
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <ShieldX className="h-4 w-4" aria-hidden="true" />
              Module disabled
            </span>
          )}
        />
      </JobsPageFrame>
    );
  }

  const parsedSearch = parseJobsSearchParams(rawSearchParams);
  if (!parsedSearch.ok) {
    return (
      <JobsPageFrame viewer={viewer} workspace={membership}>
        <JobsFilters companyId={companyId} filters={parsedSearch.filters} />
        <InvalidJobsFilterState message={parsedSearch.message} />
      </JobsPageFrame>
    );
  }

  let page;
  try {
    page = await getCompanyJobs(companyId, context.sessionToken, parsedSearch.query);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    if (error instanceof BackendTransportError && error.status === 400) {
      return (
        <JobsPageFrame viewer={viewer} workspace={membership}>
          <JobsFilters companyId={companyId} filters={parsedSearch.filters} />
          <InvalidJobsFilterState message="The pagination cursor or filter values are no longer valid. Return to the first page and try again." />
        </JobsPageFrame>
      );
    }
    throw error;
  }

  return (
    <JobsPageFrame viewer={viewer} workspace={membership}>
      <JobsFilters companyId={companyId} filters={parsedSearch.filters} />
      <JobsList
        companyId={companyId}
        jobs={page.items}
        filters={parsedSearch.filters}
        afterCursor={parsedSearch.afterCursor}
        nextCursor={page.nextCursor}
      />
    </JobsPageFrame>
  );
}
