"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { useAppToast } from "@/hooks/use-toast";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";

interface UpgradeRequest {
  id: string;
  uid: string;
  email?: string | null;
  currentTier: string;
  requestedTier: string | null;
  message: string;
  status: string;
  createdAt: string | null;
  updatedAt?: string | null;
  moderatedAt?: string | null;
  moderationNote?: string;
}

export default function AdminClient() {
  const [items, setItems] = useState<UpgradeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const { toast } = useAppToast();
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const approvedCount = items.filter((item) => item.status === "approved").length;
  const rejectedCount = items.filter((item) => item.status === "rejected").length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/callable", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify({
          operation: "listUpgradeRequestsV1",
          payload: { limit: 200 },
        }),
      });
      const payload = (await response.json()) as ClientApiResponse<{ items: UpgradeRequest[] }>;
      if (!response.ok || !payload.ok) {
        throw new Error(getClientApiErrorMessage(payload, "Failed to load upgrade requests"));
      }
      setItems(payload.data.items);
    } catch (error) {
      toast({
        title: "Upgrade request load failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const markStatus = async (id: string, status: "approved" | "rejected") => {
    setActionId(id);
    try {
      const response = await fetch("/api/callable", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify({
          operation: "moderateUpgradeRequestV1",
          payload: { requestId: id, status },
        }),
      });
      const payload = (await response.json()) as ClientApiResponse<{ requestId: string; status: string }>;
      if (!response.ok || !payload.ok) {
        throw new Error(getClientApiErrorMessage(payload, "Failed to update request"));
      }
      await load();
      toast({
        title: `Request ${status}`,
        description: `Upgrade request ${id} is now ${status}.`,
        variant: status === "approved" ? "success" : "info",
      });
    } catch (error) {
      toast({
        title: "Moderation failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    } finally {
      setActionId(null);
    }
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
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{pendingCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Approved</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{approvedCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Rejected</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{rejectedCount}</p>
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
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={actionId === row.id}
                        onClick={() => void markStatus(row.id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={actionId === row.id}
                        onClick={() => void markStatus(row.id, "rejected")}
                      >
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
