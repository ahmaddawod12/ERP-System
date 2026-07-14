import { notFound, redirect } from "next/navigation";
import {
  Boxes,
  BriefcaseBusiness,
  FileClock,
  FileText,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { EmptyState } from "@/components/states/empty-state";
import { BackendTransportError } from "@/lib/backend/transport-core";
import { getCompanyBootstrap } from "@/lib/backend/workspace-client";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Workspace overview | Smart-Job" };

const countCards = [
  { key: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { key: "clients", label: "Clients", icon: UsersRound },
  { key: "inventoryParts", label: "Inventory parts", icon: Boxes },
  { key: "documents", label: "Documents", icon: FileText },
] as const;

function formatSyncTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(value));
}

export default async function CompanyOverviewPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: rawCompanyId } = await params;
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // Enforce the URL tenant against the current server-resolved memberships
  // before issuing any company-scoped backend request.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  let bootstrap;
  try {
    bootstrap = await getCompanyBootstrap(companyId, context.sessionToken);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  const { counts, syncState, workspace } = bootstrap;
  const hasNoOperationalData = countCards.every(({ key }) => counts[key] === 0)
    && counts.pendingDocumentTasks === 0;

  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace}>
      <section className="dashboard-page" aria-labelledby="overview-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="dashboard-kicker">Server-rendered overview</p>
              <h1 id="overview-heading" className="dashboard-title mt-4">{workspace.name}</h1>
              <p className="dashboard-copy mt-3">
                Current counts are loaded securely for this workspace before the page is sent to your browser.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">{workspace.accountType}</Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace totals">
          {countCards.map(({ key, label, icon: Icon }) => (
            <Card key={key} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 font-mono text-3xl font-semibold text-slate-950 dark:text-white">
                {counts[key].toLocaleString("en")}
              </p>
            </Card>
          ))}
        </div>

        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
              <FileClock className="h-4 w-4" />
              Document processing
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {counts.pendingDocumentTasks.toLocaleString("en")} pending task{counts.pendingDocumentTasks === 1 ? "" : "s"}
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Synced <time dateTime={syncState.updatedAt}>{formatSyncTime(syncState.updatedAt)}</time>
          </p>
        </Card>

        {hasNoOperationalData ? (
          <EmptyState
            title="This workspace is ready"
            description="There are no jobs, clients, inventory parts, or documents yet. The existing workflows remain available while each tenant-scoped page is migrated."
          />
        ) : null}
      </section>
    </ServerWorkspaceShell>
  );
}
