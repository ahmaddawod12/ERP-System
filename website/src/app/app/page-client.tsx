"use client";

import { useEffect, useState } from "react";
import { BarChart3, Building2, ShieldCheck, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAppContext } from "@/hooks/use-app-context";
import { roleUsesScopedJobAccess } from "@/lib/job-access";
import { loadOverviewCounts, resolveCompanyScope } from "@/lib/services/backend-service";

interface StatItem {
  label: string;
  value: number;
}

export default function AppOverviewClient() {
  const { uid, companyId, profile, tier } = useAppContext();
  const [stats, setStats] = useState<StatItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!profile || !uid) return;
      const scopeId = resolveCompanyScope(companyId);
      if (!scopeId) {
        setStats([]);
        return;
      }

      try {
        const counts = await loadOverviewCounts(scopeId);
        if (cancelled) return;

        const useCompanyInventory = profile.role === "manager" || profile.role === "dev";
        const inventoryPartsCount = useCompanyInventory
          ? (counts.companyInventoryParts ?? 0)
          : (counts.inventoryParts ?? 0);

        setStats([
          {
            label: roleUsesScopedJobAccess(profile.role) ? "My Jobs" : "Total Jobs",
            value: counts.jobs ?? 0,
          },
          {
            label: "Clients",
            value: counts.clients ?? 0,
          },
          {
            label: "Inventory Parts",
            value: inventoryPartsCount,
          },
        ]);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load overview stats", error);
          setStats([]);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId, profile, uid]);

  return (
    <ProtectedRoute section="overview">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Overview
              </p>
              <h1 className="dashboard-title mt-5">Dashboard Overview</h1>
              <p className="dashboard-copy mt-4">
                Welcome back{profile?.name ? `, ${profile.name}` : ""}. Your access is controlled by role and tier.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge>{profile?.role}</Badge>
              <Badge variant="success">{tier}</Badge>
              <Badge variant="info">Company: {companyId ?? "N/A"}</Badge>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="dashboard-stat">
              <p className="text-sm text-slate-500 dark:text-slate-400">Access role</p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                {profile?.role ?? "Unknown"}
              </p>
            </div>
            <div className="dashboard-stat">
              <p className="text-sm text-slate-500 dark:text-slate-400">Active tier</p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">{tier}</p>
            </div>
            <div className="dashboard-stat">
              <p className="text-sm text-slate-500 dark:text-slate-400">Company scope</p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                {companyId ?? "Pending"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={stat.label} className={index === 0 ? "border-blue-200 bg-blue-50 dark:border-blue-900/70 dark:bg-blue-950/30" : undefined}>
              <p className="text-sm text-slate-500 dark:text-slate-400">{stat.label}</p>
              <p className="mt-2 text-4xl font-semibold tracking-normal text-slate-950 dark:text-white">
                {stat.value}
              </p>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Operational pulse</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  These metrics reflect the current scoped workspace for your account.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Jobs, clients, and inventory are shaped by your role and company membership.
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                The web dashboard is designed for visibility and controlled workflows, not unrestricted direct writes.
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Workspace guardrails</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Identity, company scope, and mutation paths remain explicit.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <Building2 className="mt-0.5 h-4 w-4" />
                <span>Company data remains scoped by companyId.</span>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <ShieldCheck className="mt-0.5 h-4 w-4" />
                <span>Protected business collections are updated through backend flows.</span>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </ProtectedRoute>
  );
}
