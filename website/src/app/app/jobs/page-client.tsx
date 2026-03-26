"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import {
  createJob,
  createFinishedJob,
  deleteJob,
  listJobs,
  listWorkers,
  resolveCompanyScope,
  updateJob,
} from "@/lib/services/firestore-service";
import {
  buildJobAssignmentPatch,
  buildListJobsOptions,
  buildManagedJobCreatePayload,
  buildSoloFinishedJobPayload,
  getWorkerDisplayName,
  normalizeMembershipId,
} from "@/lib/job-access";
import type { JobRecord, WorkerProfile } from "@/lib/types";

interface JobFormState {
  title: string;
  cname: string;
  description: string;
  wid: string;
}

const initialState: JobFormState = {
  title: "",
  cname: "",
  description: "",
  wid: "",
};

export default function JobsClient() {
  const { uid, companyId, role, profile } = useAppContext();
  const { toast } = useAppToast();
  const [form, setForm] = useState<JobFormState>(initialState);
  const [pendingJobs, setPendingJobs] = useState<JobRecord[]>([]);
  const [finishedJobs, setFinishedJobs] = useState<JobRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const scopeId = resolveCompanyScope(companyId);
  const canManageCompanyJobs = role === "manager" || role === "dev";
  const isSoloUser = role === "user" && profile?.accountType === "solo";
  const ownWorkerWid = normalizeMembershipId(profile?.wid);

  const workerNameMap = useMemo(() => {
    const entries = workers.map((worker) => [
      normalizeMembershipId(worker.wid) ?? String(worker.wid),
      getWorkerDisplayName(worker) ?? String(worker.wid),
    ]);

    if (ownWorkerWid) {
      entries.push([ownWorkerWid, profile?.name || profile?.email || ownWorkerWid]);
    }

    return Object.fromEntries(entries);
  }, [ownWorkerWid, profile?.email, profile?.name, workers]);

  const loadJobs = useCallback(async () => {
    if (!scopeId) {
      setPendingJobs([]);
      setFinishedJobs([]);
      setWorkers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [jobsResult, workersResult] = await Promise.all([
      listJobs(scopeId, buildListJobsOptions(role, profile)),
      canManageCompanyJobs ? listWorkers(scopeId) : Promise.resolve([]),
    ]);
    setPendingJobs(jobsResult.pending);
    setFinishedJobs(jobsResult.finished);
    setWorkers(workersResult);
    setLoading(false);
  }, [scopeId, canManageCompanyJobs, profile, role]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const createNewJob = async () => {
    if (!form.title || !form.cname || !uid || !scopeId) {
      toast({ title: "Missing fields", description: "Title and client are required.", variant: "error" });
      return;
    }

    try {
      if (isSoloUser) {
        await createFinishedJob(scopeId, buildSoloFinishedJobPayload(form, profile));
      } else {
        const assignee =
          workers.find((worker) => normalizeMembershipId(worker.wid) === form.wid) ?? null;

        await createJob(scopeId, buildManagedJobCreatePayload(form, profile, assignee));
      }
      await loadJobs();
      setForm(initialState);
      toast({ title: "Job created", variant: "success" });
    } catch (error) {
      toast({
        title: "Failed to create job",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  const handleJobUpdate = async (
    jobId: string,
    payload: Partial<JobRecord>,
  ) => {
    if (!scopeId) return;
    try {
      await updateJob(scopeId, jobId, payload);
      await loadJobs();
      toast({ title: "Job updated", variant: "success" });
    } catch (error) {
      toast({
        title: "Job update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  const removeJob = async (jobId: string) => {
    if (!scopeId) return;
    await deleteJob(scopeId, jobId);
    await loadJobs();
    toast({ title: "Job removed", variant: "info" });
  };

  return (
    <ProtectedRoute section="jobs">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {isSoloUser ? "My Jobs" : "Company Jobs"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {isSoloUser
              ? "Create and manage your job workflow."
              : "Manage pending and completed jobs, worker assignments, and status updates."}
          </p>

          {(isSoloUser || canManageCompanyJobs) ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Input
                label="Job title"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <Input
                label="Client name"
                value={form.cname}
                onChange={(event) => setForm((prev) => ({ ...prev, cname: event.target.value }))}
              />
              <label className="md:col-span-2">
                <span className="mb-1.5 inline-flex text-sm font-medium text-slate-700 dark:text-slate-200">
                  Description
                </span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
              {canManageCompanyJobs ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Assign worker</span>
                  <select
                    value={form.wid}
                    onChange={(event) => setForm((prev) => ({ ...prev, wid: event.target.value }))}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Unassigned</option>
                    {workers.map((worker) => (
                      <option key={worker.wid} value={worker.wid}>
                        {worker.name || worker.email}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex items-end">
                <Button onClick={createNewJob}>Create job</Button>
              </div>
            </div>
          ) : null}
        </Card>

        {loading ? <LoadingState /> : null}

        {!loading && pendingJobs.length === 0 && finishedJobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description={isSoloUser ? "Add your first job to get started." : "Create your first company job above."}
          />
        ) : null}

        {!loading && pendingJobs.length > 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pending</h2>
            <div className="mt-4">
              <DataTable
                data={pendingJobs}
                columns={[
                  {
                    key: "title",
                    header: "Job",
                    render: (row) => (
                      <div>
                        <p className="font-medium">{row.title}</p>
                        <p className="text-xs text-slate-500">{row.cname}</p>
                      </div>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => <Badge>{row.status}</Badge>,
                  },
                  {
                    key: "worker",
                    header: "Worker",
                    render: (row) => (
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        {row.wid ? workerNameMap[row.wid] || row.wid : "Unassigned"}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (row) => (
                      <div className="flex flex-wrap gap-2">
                        {canManageCompanyJobs ? (
                          <select
                            defaultValue={row.wid ?? ""}
                            onChange={(event) => {
                              const selectedWid = event.target.value;
                              const assignee =
                                workers.find((worker) => normalizeMembershipId(worker.wid) === selectedWid) ?? null;
                              void handleJobUpdate(row.id, buildJobAssignmentPatch(assignee, profile));
                            }}
                            className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="">Unassigned</option>
                            {workers.map((worker) => (
                              <option key={worker.wid} value={worker.wid}>
                                {worker.name || worker.email}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <select
                          defaultValue={row.status}
                          onChange={(event) =>
                            void handleJobUpdate(row.id, {
                              status: event.target.value as JobRecord["status"],
                            })
                          }
                          className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="pending">pending</option>
                          <option value="waiting">waiting</option>
                          <option value="finished">finished</option>
                          <option value="denied">denied</option>
                        </select>
                        {isSoloUser ? (
                          <Button size="sm" variant="danger" onClick={() => void removeJob(row.id)}>
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        ) : null}

        {!loading && finishedJobs.length > 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Finished</h2>
            <div className="mt-4">
              <DataTable
                data={finishedJobs}
                columns={[
                  {
                    key: "title",
                    header: "Job",
                    render: (row) => (
                      <div>
                        <p className="font-medium">{row.title}</p>
                        <p className="text-xs text-slate-500">{row.cname}</p>
                      </div>
                    ),
                  },
                  {
                    key: "worker",
                    header: "Worker",
                    render: (row) => workerNameMap[row.wid ?? ""] || row.wid || "N/A",
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => (
                      <Badge variant={row.status === "denied" ? "danger" : "success"}>{row.status}</Badge>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        ) : null}
      </section>
    </ProtectedRoute>
  );
}
