"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Sparkles, Users } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { EmptyState } from "@/components/states/empty-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { listWorkers, updateWorkerRole } from "@/lib/services/firestore-service";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";
import type { Role, WorkerProfile } from "@/lib/types";

export default function WorkersClient() {
  const { companyId } = useAppContext();
  const { toast } = useAppToast();
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"worker" | "user" | "basic">("worker");
  const workersCount = workers.filter((worker) => worker.role === "worker").length;
  const usersCount = workers.filter((worker) => worker.role === "user").length;
  const basicCount = workers.filter((worker) => worker.role === "basic").length;

  const load = useCallback(async () => {
    if (!companyId) {
      setWorkers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await listWorkers(companyId);
    setWorkers(result);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvite = async () => {
    if (!companyId) return;
    try {
      const response = await fetch("/api/callable", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify({
          operation: "createInviteV1",
          payload: { companyId, targetRole: inviteRole },
        }),
      });
      const payload = (await response.json()) as ClientApiResponse<{
        inviteId: string;
        inviteCode: string;
        expiresAt: string;
        targetRole: "worker" | "user" | "basic";
      }>;

      if (!response.ok || !payload.ok) {
        toast({
          title: "Invite creation failed",
          description: getClientApiErrorMessage(payload, "Request failed"),
          variant: "error",
        });
        return;
      }

      setInviteCode(payload.data.inviteCode);
      toast({
        title: "Invite created",
        description: `Code: ${payload.data.inviteCode}`,
        variant: "success",
      });
      await load();
    } catch (error) {
      toast({
        title: "Invite creation failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  const handleRoleChange = async (wid: string | number, workerUid: string | undefined, role: Role) => {
    if (!companyId) return;
    await updateWorkerRole(companyId, String(workerUid || ""), String(wid), role);
    await load();
    toast({ title: "Worker role updated", variant: "success" });
  };

  return (
    <ProtectedRoute section="workers">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Workers
              </p>
              <h1 className="dashboard-title mt-5">Team access and invites</h1>
              <p className="dashboard-copy mt-4">
                Invite and manage company worker roles without losing visibility into who can access which workflow.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Workers</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{workersCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Users</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{usersCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Basic</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{basicCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Create an invite</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Generate a role-scoped invite code for onboarding into the company.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as "worker" | "user" | "basic")}
                  className="dashboard-field h-10 min-w-32"
                >
                  <option value="worker">worker</option>
                  <option value="user">user</option>
                  <option value="basic">basic</option>
                </select>
                <Button onClick={() => void createInvite()}>Create invite code</Button>
              </div>
            </div>
            {inviteCode ? (
              <div className="mt-4 rounded-[1.2rem] border border-emerald-300/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100">
                Latest invite code: <strong>{inviteCode}</strong>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Role controls</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Team members can be promoted or limited without leaving the dashboard workspace.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Invite codes are role-targeted from creation time.
              </div>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <Badge>worker</Badge>
                <Badge variant="info">user</Badge>
                <Badge variant="warning">basic</Badge>
              </div>
            </div>
          </Card>
        </div>

        {loading ? <LoadingState /> : null}
        {!loading && workers.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Create an invite code to onboard the first worker, user, or basic account into the company workspace."
          />
        ) : null}

        {!loading && workers.length > 0 ? (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Directory</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Manage joined workers and adjust their role access.
                </p>
              </div>
              <Badge variant="info">{workers.length} members</Badge>
            </div>
            <DataTable
              data={workers}
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <div>
                      <p className="font-medium">{row.name || "Unnamed"}</p>
                      <p className="text-xs text-slate-500">{row.email}</p>
                    </div>
                  ),
                },
                {
                  key: "wid",
                  header: "Worker ID",
                  render: (row) => row.wid,
                },
                {
                  key: "role",
                  header: "Role",
                  render: (row) => (
                    <select
                      defaultValue={row.role}
                      onChange={(event) => void handleRoleChange(row.wid, row.uid, event.target.value as Role)}
                      className="dashboard-table-select"
                    >
                      <option value="worker">worker</option>
                      <option value="user">user</option>
                      <option value="basic">basic</option>
                    </select>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}
      </section>
    </ProtectedRoute>
  );
}
