import Link from "next/link";
import { BriefcaseBusiness, Building2, ChevronRight, FileText, Gauge, Package, Settings as SettingsIcon, TrendingUp, Users, UsersRound } from "lucide-react";
import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { OpaqueSessionLogout } from "@/components/auth/opaque-session-logout";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

type WorkspaceSection = "overview" | "jobs" | "clients" | "documents" | "inventory" | "workers" | "settings" | "upgrade";

const activeNavigationClass = "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
const idleNavigationClass = "text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900";

export function ServerWorkspaceShell({
  viewer,
  workspace,
  activeSection = "overview",
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  activeSection?: WorkspaceSection;
  children: React.ReactNode;
}) {
  const viewerLabel = viewer.displayName ?? viewer.email ?? "Signed-in user";
  const jobsEnabled = workspace.enabledModules.includes("solojob");
  const clientsEnabled = workspace.enabledModules.includes("clients");
  const documentsAvailable = workspace.enabledModules.includes("documents")
    && workspace.role !== "worker";
  const inventoryAvailable = workspace.enabledModules.includes("inventory")
    && workspace.role !== "basic";
  const workersAvailable = workspace.enabledModules.includes("team")
    && (workspace.role === "manager" || workspace.role === "dev");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex w-full max-w-[86rem] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="brand-mark" aria-hidden="true">SJ</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-950 dark:text-white">Smart-Job ERP</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{viewerLabel}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge>{workspace.role}</Badge>
            <Badge variant="info">Company {workspace.companyId}</Badge>
            {viewer.workspaces.length > 1 ? (
              <Link
                href="/app/select-company"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              >
                <Building2 className="h-4 w-4" />
                Switch workspace
              </Link>
            ) : null}
            <OpaqueSessionLogout />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[86rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
        <aside>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {workspace.name}
            </p>
            <Link
              href={`/app/c/${workspace.companyId}`}
              aria-current={activeSection === "overview" ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                activeSection === "overview" ? activeNavigationClass : idleNavigationClass,
              )}
            >
              <span className="inline-flex items-center gap-3">
                <Gauge className="h-4 w-4" />
                Overview
              </span>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
            {jobsEnabled ? (
              <Link
                href={`/app/c/${workspace.companyId}/jobs`}
                aria-current={activeSection === "jobs" ? "page" : undefined}
                className={cn(
                  "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  activeSection === "jobs" ? activeNavigationClass : idleNavigationClass,
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <BriefcaseBusiness className="h-4 w-4" />
                  Jobs
                </span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                <BriefcaseBusiness className="h-4 w-4" />
                Jobs unavailable
              </span>
            )}
            {clientsEnabled ? (
              <Link
                href={`/app/c/${workspace.companyId}/clients`}
                aria-current={activeSection === "clients" ? "page" : undefined}
                className={cn(
                  "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  activeSection === "clients" ? activeNavigationClass : idleNavigationClass,
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <UsersRound className="h-4 w-4" />
                  Clients
                </span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                <UsersRound className="h-4 w-4" />
                Clients unavailable
              </span>
            )}
            {documentsAvailable ? (
              <Link
                href={`/app/c/${workspace.companyId}/documents`}
                aria-current={activeSection === "documents" ? "page" : undefined}
                className={cn(
                  "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  activeSection === "documents" ? activeNavigationClass : idleNavigationClass,
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Documents
                </span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                Documents unavailable
              </span>
            )}
            {inventoryAvailable ? (
              <Link
                href={`/app/c/${workspace.companyId}/inventory`}
                aria-current={activeSection === "inventory" ? "page" : undefined}
                className={cn(
                  "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  activeSection === "inventory" ? activeNavigationClass : idleNavigationClass,
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <Package className="h-4 w-4" aria-hidden="true" />
                  Inventory
                </span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                <Package className="h-4 w-4" aria-hidden="true" />
                Inventory unavailable
              </span>
            )}
            {workersAvailable ? (
              <Link
                href={`/app/c/${workspace.companyId}/workers`}
                aria-current={activeSection === "workers" ? "page" : undefined}
                className={cn(
                  "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  activeSection === "workers" ? activeNavigationClass : idleNavigationClass,
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Team
                </span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-600"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Team unavailable
              </span>
            )}
            <Link
              href={`/app/c/${workspace.companyId}/settings`}
              aria-current={activeSection === "settings" ? "page" : undefined}
              className={cn(
                "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                activeSection === "settings" ? activeNavigationClass : idleNavigationClass,
              )}
            >
              <span className="inline-flex items-center gap-3">
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                Settings
              </span>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
            <Link
              href={`/app/c/${workspace.companyId}/upgrade`}
              aria-current={activeSection === "upgrade" ? "page" : undefined}
              className={cn(
                "mt-1 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                activeSection === "upgrade" ? activeNavigationClass : idleNavigationClass,
              )}
            >
              <span className="inline-flex items-center gap-3">
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Upgrade
              </span>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
            <p className="px-3 pb-1 pt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Every page in this workspace keeps the company scope explicit in its URL.
            </p>
          </div>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
