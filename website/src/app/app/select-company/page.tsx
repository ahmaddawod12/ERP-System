import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { requireWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Select workspace | Smart-Job" };

export default async function SelectCompanyPage() {
  const { viewer } = await requireWebsiteSession("/app/select-company");
  const decision = decideWorkspaceEntry(viewer.workspaces);

  if (decision.kind === "onboarding") {
    redirect("/onboarding");
  }
  if (decision.kind === "workspace") {
    redirect(`/app/c/${decision.companyId}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true">SJ</span>
          <div>
            <p className="text-sm font-semibold text-slate-950 dark:text-white">Smart-Job ERP</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {viewer.displayName ?? viewer.email ?? "Signed-in user"}
            </p>
          </div>
        </div>

        <section className="mt-10" aria-labelledby="workspace-heading">
          <p className="dashboard-kicker">
            <Layers3 className="h-4 w-4" />
            Tenant access
          </p>
          <h1 id="workspace-heading" className="dashboard-title mt-4">Choose a workspace</h1>
          <p className="dashboard-copy mt-3 max-w-2xl">
            Your role and enabled modules are resolved by the backend for each company. You can switch again at any time.
          </p>

          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {viewer.workspaces.map((workspace) => (
              <Card key={workspace.companyId} className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge>{workspace.role}</Badge>
                    <Badge variant="info">{workspace.accountType}</Badge>
                  </div>
                </div>

                <h2 className="mt-5 text-lg font-semibold text-slate-950 dark:text-white">{workspace.name}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Company {workspace.companyId}
                  {workspace.memberNo ? ` · Member ${workspace.memberNo}` : ""}
                </p>
                <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {workspace.enabledModules.length > 0
                    ? `${workspace.enabledModules.length} enabled module${workspace.enabledModules.length === 1 ? "" : "s"}`
                    : "Core workspace access"}
                </p>

                <Link
                  href={`/app/c/${workspace.companyId}`}
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  aria-label={`Open ${workspace.name}`}
                >
                  Open workspace
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
