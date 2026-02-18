"use client";

import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/firebase/client";
import { useAppContext } from "@/hooks/use-app-context";

interface StatItem {
  label: string;
  value: number;
}

export default function AppOverviewPage() {
  const { uid, companyId, profile, tier } = useAppContext();
  const [stats, setStats] = useState<StatItem[]>([]);

  useEffect(() => {
    async function load() {
      if (!profile) return;
      const items: StatItem[] = [];

      if (companyId) {
        const pendingCount = await getCountFromServer(collection(db, "companies", companyId, "PendingJobs"));
        const finishedCount = await getCountFromServer(collection(db, "companies", companyId, "finishedJobs"));
        const clientsCount = await getCountFromServer(collection(db, "companies", companyId, "clients"));
        items.push({ label: "Pending Jobs", value: pendingCount.data().count });
        items.push({ label: "Finished Jobs", value: finishedCount.data().count });
        items.push({ label: "Clients", value: clientsCount.data().count });
      } else if (uid) {
        const jobsCount = await getCountFromServer(collection(db, "users", uid, "jobs"));
        const invCount = await getCountFromServer(collection(db, "users", uid, "personal_inventory"));
        items.push({ label: "My Jobs", value: jobsCount.data().count });
        items.push({ label: "Personal Inventory", value: invCount.data().count });
      }

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
            {companyId ? <Badge>Company: {companyId}</Badge> : <Badge>Solo mode</Badge>}
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

