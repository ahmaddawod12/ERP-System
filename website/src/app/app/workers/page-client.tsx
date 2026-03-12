"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
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
      const response = await fetch("/api/invites/create", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify({ companyId }),
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

  const handleRoleChange = async (wid: string | number, role: Role) => {
    if (!companyId) return;
    await updateWorkerRole(companyId, String(wid), role);
    await load();
    toast({ title: "Worker role updated", variant: "success" });
  };

  return (
    <ProtectedRoute section="workers">
      <section className="grid gap-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workers</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Invite and manage company worker roles.</p>
            </div>
            <Button onClick={() => void createInvite()}>Create invite code</Button>
          </div>
          {inviteCode ? (
            <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-600/50 dark:bg-emerald-900/40 dark:text-emerald-100">
              Latest invite code: <strong>{inviteCode}</strong>
            </p>
          ) : null}
        </Card>

        {loading ? <LoadingState /> : null}
        {!loading && workers.length === 0 ? (
          <EmptyState title="No workers yet" description="Use invite codes to onboard workers into your company." />
        ) : null}

        {!loading && workers.length > 0 ? (
          <Card>
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
                      onChange={(event) => void handleRoleChange(row.wid, event.target.value as Role)}
                      className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
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
