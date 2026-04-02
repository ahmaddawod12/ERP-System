"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, updateDoc, doc } from "firebase/firestore";
import { ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { db } from "@/lib/firebase/client";

interface UpgradeRequest {
  id: string;
  uid: string;
  currentTier: string;
  requestedTier: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function AdminClient() {
  const [items, setItems] = useState<UpgradeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const approvedCount = items.filter((item) => item.status === "approved").length;
  const rejectedCount = items.filter((item) => item.status === "rejected").length;

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(query(collection(db, "upgrade_requests"), orderBy("createdAt", "desc")));
    setItems(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<UpgradeRequest, "id">) })));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const markStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, "upgrade_requests", id), {
      status,
      updatedAt: new Date().toISOString(),
    });
    await load();
  };

  return (
    <ProtectedRoute section="admin">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Admin
              </p>
              <h1 className="dashboard-title mt-5">Upgrade request review</h1>
              <p className="dashboard-copy mt-4">
                Lightweight admin view for upgrade requests. Extend with support queues and audit logs.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{pendingCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Approved</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{approvedCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Rejected</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{rejectedCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Queue status</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Review upgrade demand before changing account access.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Pending requests are the next decisions requiring manual review.
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Approval and rejection both write a new status timestamp to the request record.
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Admin note</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  This is still a lightweight surface intended for controlled manual operations.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Upgrade requests</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Approve or reject queued plan-change requests.
                </p>
              </div>
              <Badge variant="info">{items.length} requests</Badge>
            </div>
            <DataTable
              data={items}
              emptyMessage="No upgrade requests yet. New manual plan-change requests will appear here."
              columns={[
                { key: "uid", header: "UID", render: (row) => row.uid },
                {
                  key: "tiers",
                  header: "Tier change",
                  render: (row) => (
                    <div className="text-sm">
                      <span>{row.currentTier}</span>{" -> "}<span>{row.requestedTier}</span>
                    </div>
                  ),
                },
                {
                  key: "message",
                  header: "Message",
                  render: (row) => <span className="text-sm">{row.message}</span>,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <Badge variant={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"}>
                      {row.status}
                    </Badge>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) => (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void markStatus(row.id, "approved")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void markStatus(row.id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </section>
    </ProtectedRoute>
  );
}
