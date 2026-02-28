"use client";

import { useEffect, useState } from "react";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/firebase/client";
import { useAppContext } from "@/hooks/use-app-context";
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

      const jobsCount = await getCountFromServer(collection(db, "companies", scopeId, "jobs"));
      const clientsCount = await getCountFromServer(collection(db, "companies", scopeId, "clients"));
      items.push({ label: "Total Jobs", value: jobsCount.data().count });
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
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Dashboard Overview</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Welcome back{profile?.name ? `, ${profile.name}` : ""}. Your access is controlled by role and tier.
          </p>
          <div className="mt-4 flex gap-2">
            <Badge>{profile?.role}</Badge>
            <Badge variant="success">{tier}</Badge>
            <Badge>Company: {companyId ?? "N/A"}</Badge>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <p className="text-sm text-slate-500 dark:text-slate-400">{stat.label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{stat.value}</p>
            </Card>
          ))}
        </div>
      </section>
    </ProtectedRoute>
  );
}
