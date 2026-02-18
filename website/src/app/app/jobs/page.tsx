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
  addUserJob,
  createJob,
  deleteUserJob,
  listJobs,
  listUserJobs,
  listWorkers,
  updateJob,
  updateUserJob,
} from "@/lib/services/firestore-service";
import type { JobRecord, WorkerProfile } from "@/lib/types";

interface JobFormState {
  title: string;
  clientName: string;
  description: string;
  workerId: string;
}

const initialState: JobFormState = {
  title: "",
  clientName: "",
  description: "",
  workerId: "",
};

export default function JobsPage() {
  const { uid, companyId, role } = useAppContext();
  const { toast } = useAppToast();
  const [form, setForm] = useState<JobFormState>(initialState);
  const [pendingJobs, setPendingJobs] = useState<JobRecord[]>([]);
  const [finishedJobs, setFinishedJobs] = useState<JobRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const canManageCompanyJobs = role === "Manager" || role === "Dev";

  const workerNameMap = useMemo(
    () => Object.fromEntries(workers.map((worker) => [worker.workerId, worker.name || worker.email])),
    [workers],
  );

  const loadTeamJobs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [jobsResult, workersResult] = await Promise.all([
      listJobs(companyId, { role: role ?? undefined, uid: uid ?? undefined }),
      listWorkers(companyId),
    ]);
    setPendingJobs(jobsResult.pending);
    setFinishedJobs(jobsResult.finished);
    setWorkers(workersResult);
    setLoading(false);
  }, [companyId, role, uid]);

  const loadSoloJobs = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const jobs = await listUserJobs(uid);
    setPendingJobs(jobs.filter((job) => job.status !== "completed"));
    setFinishedJobs(jobs.filter((job) => job.status === "completed"));
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    if (companyId) {
      void loadTeamJobs();
    } else {
      void loadSoloJobs();
    }
  }, [companyId, loadSoloJobs, loadTeamJobs, uid]);

  const createNewJob = async () => {
    if (!form.title || !form.clientName || !uid) {
      toast({ title: "Missing fields", description: "Title and client are required.", variant: "error" });
      return;
    }

    try {
      if (companyId) {
        await createJob(companyId, {
          title: form.title,
          clientName: form.clientName,
          description: form.description,
          status: "pending",
          workerId: form.workerId || null,
        });
        await loadTeamJobs();
      } else {
        await addUserJob(uid, {
          title: form.title,
          clientName: form.clientName,
          description: form.description,
          status: "pending",
          workerId: uid,
        });
        await loadSoloJobs();
      }
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
    try {
      if (companyId) {
        await updateJob(companyId, jobId, payload);
        await loadTeamJobs();
      } else if (uid) {
        await updateUserJob(uid, jobId, payload);
        await loadSoloJobs();
      }
      toast({ title: "Job updated", variant: "success" });
    } catch (error) {
      toast({
        title: "Job update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  const removeSoloJob = async (jobId: string) => {
    if (!uid) return;
    await deleteUserJob(uid, jobId);
    await loadSoloJobs();
    toast({ title: "Job removed", variant: "info" });
  };

  return (
    <ProtectedRoute section="jobs">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {companyId ? "Company Jobs" : "My Jobs"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {companyId
              ? "Manage pending and completed jobs, worker assignments, and status updates."
              : "Create and manage your personal job workflow."}
          </p>

          {(companyId ? canManageCompanyJobs : true) ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Input
                label="Job title"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <Input
                label="Client name"
                value={form.clientName}
                onChange={(event) => setForm((prev) => ({ ...prev, clientName: event.target.value }))}
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
              {companyId && canManageCompanyJobs ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Assign worker</span>
                  <select
                    value={form.workerId}
                    onChange={(event) => setForm((prev) => ({ ...prev, workerId: event.target.value }))}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Unassigned</option>
                    {workers.map((worker) => (
                      <option key={worker.workerId} value={worker.workerId}>
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
            description={companyId ? "Create your first company job above." : "Add your first job to get started."}
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
                        <p className="text-xs text-slate-500">{row.clientName}</p>
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
                        {row.workerId ? workerNameMap[row.workerId] || row.workerId : "Unassigned"}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (row) => (
                      <div className="flex flex-wrap gap-2">
                        {companyId && canManageCompanyJobs ? (
                          <select
                            defaultValue={row.workerId ?? ""}
                            onChange={(event) => {
                              void handleJobUpdate(row.id, { workerId: event.target.value || null });
                            }}
                            className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="">Unassigned</option>
                            {workers.map((worker) => (
                              <option key={worker.workerId} value={worker.workerId}>
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
                          <option value="in_progress">in_progress</option>
                          <option value="completed">completed</option>
                        </select>
                        {!companyId ? (
                          <Button size="sm" variant="danger" onClick={() => void removeSoloJob(row.id)}>
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
                        <p className="text-xs text-slate-500">{row.clientName}</p>
                      </div>
                    ),
                  },
                  {
                    key: "worker",
                    header: "Worker",
                    render: (row) => workerNameMap[row.workerId ?? ""] || row.workerId || "N/A",
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => <Badge variant="success">{row.status}</Badge>,
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
