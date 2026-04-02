"use client";

import { useEffect, useState } from "react";
import { collection, doc, getCountFromServer, getDoc, query, where } from "firebase/firestore";
import { BarChart3, Building2, ShieldCheck, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/firebase/client";
import { useAppContext } from "@/hooks/use-app-context";
import { buildMembershipQueryValues, roleUsesScopedJobAccess } from "@/lib/job-access";
import { resolveCompanyScope } from "@/lib/services/firestore-service";
import type { InventoryDoc } from "@/lib/types";

interface StatItem {
  label: string;
  value: number;
}

export default function AppOverviewClient() {
  const { uid, companyId, profile, tier } = useAppContext();
  const [stats, setStats] = useState<StatItem[]>([]);

  useEffect(() => {
    async function load() {
      if (!profile || !uid) return;
      const items: StatItem[] = [];
      const scopeId = resolveCompanyScope(companyId);
      if (!scopeId) {
        setStats([]);
        return;
      }

      const jobsCollection = collection(db, "companies", scopeId, "jobs");
      const workerQueryValues = buildMembershipQueryValues(profile.wid);
      const jobsCount =
        roleUsesScopedJobAccess(profile.role)
          ? workerQueryValues.length > 0
            ? await getCountFromServer(
                query(
                  jobsCollection,
                  workerQueryValues.length === 1
                    ? where("wid", "==", workerQueryValues[0])
                    : where("wid", "in", [...workerQueryValues]),
                ),
              )
            : null
          : await getCountFromServer(jobsCollection);
      const clientsCount = await getCountFromServer(collection(db, "companies", scopeId, "clients"));
      items.push({
        label: roleUsesScopedJobAccess(profile.role) ? "My Jobs" : "Total Jobs",
        value: jobsCount?.data().count ?? 0,
      });
      items.push({ label: "Clients", value: clientsCount.data().count });

      // Inventory parts count from single-doc
      const useCompanyInventory = profile.role === "manager" || profile.role === "dev";
      const invRef = useCompanyInventory
        ? doc(db, "companies", scopeId, "data", "inventory")
        : doc(db, "users", uid, "data", "inventory");
      const invSnap = await getDoc(invRef);
      const invData = invSnap.exists() ? (invSnap.data() as InventoryDoc) : null;
      items.push({ label: "Inventory Parts", value: invData?.parts?.length ?? 0 });

      setStats(items);
    }

    void load();
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
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {profile?.role ?? "Unknown"}
              </p>
            </div>
            <div className="dashboard-stat">
              <p className="text-sm text-slate-500 dark:text-slate-400">Active tier</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">{tier}</p>
            </div>
            <div className="dashboard-stat">
              <p className="text-sm text-slate-500 dark:text-slate-400">Company scope</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {companyId ?? "Pending"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={stat.label} className={index === 0 ? "bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(8,145,178,0.78))] text-white dark:bg-[linear-gradient(145deg,rgba(103,232,249,0.9),rgba(224,242,254,0.95))] dark:text-slate-950" : undefined}>
              <p className={index === 0 ? "text-sm text-slate-200 dark:text-slate-700" : "text-sm text-slate-500 dark:text-slate-400"}>{stat.label}</p>
              <p className={index === 0 ? "mt-2 text-4xl font-semibold tracking-[-0.05em] text-white dark:text-slate-950" : "mt-2 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white"}>
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
