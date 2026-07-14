import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, ShieldCheck, TrendingUp } from "lucide-react";

import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { UpgradeRequestForm } from "@/components/upgrade/upgrade-request-form";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import { findViewerWorkspace, parsePublicCompanyId } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Request upgrade | Smart-Job" };

export default async function TenantUpgradePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: rawCompanyId } = await params;
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/upgrade`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;
  if (viewer.workspaces.length === 0) redirect("/onboarding");
  const companyId = parsePublicCompanyId(rawCompanyId);
  if (companyId === null) notFound();
  const workspace = findViewerWorkspace(viewer.workspaces, companyId);
  if (workspace === null) notFound();

  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="upgrade">
      <section className="dashboard-page" aria-labelledby="upgrade-heading">
        <div className="dashboard-hero">
          <p className="dashboard-kicker"><TrendingUp className="h-3.5 w-3.5" /> Plan review</p>
          <h1 id="upgrade-heading" className="dashboard-title mt-4">Request a workspace upgrade</h1>
          <p className="dashboard-copy mt-3">
            The API derives the active tier and your role from this workspace. Requests are reviewed before access changes.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <Card>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Upgrade details</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Explain the operational need so the reviewer has enough context.
            </p>
            <div className="mt-5"><UpgradeRequestForm companyId={companyId} /></div>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Controlled application</h2>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <p className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                Approval updates the tier and enabled modules in one database transaction.
              </p>
              <p className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                Stale admin decisions are rejected instead of overwriting a newer review.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ArrowUpRight className="h-3.5 w-3.5" /> Manual review</span>
            </div>
          </Card>
        </div>
      </section>
    </ServerWorkspaceShell>
  );
}
