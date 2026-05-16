"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Sparkles, UsersRound } from "lucide-react";
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
} from "@/lib/services/backend-service";
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
  cphone: string;
  description: string;
  location: string;
  wid: string;
}

const initialState: JobFormState = {
  title: "",
  cname: "",
  cphone: "",
  description: "",
  location: "",
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
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const pendingAssignedCount = pendingJobs.filter((job) => Boolean(job.wid)).length;
  const waitingCount = pendingJobs.filter((job) => job.status === "waiting").length;
  const statusOptions: JobRecord["status"][] = canManageCompanyJobs
    ? ["pending", "waiting", "finished", "denied"]
    : ["pending", "waiting"];

  const statusBadgeVariant = (status: JobRecord["status"]) => {
    if (status === "finished") return "success" as const;
    if (status === "waiting") return "warning" as const;
    if (status === "denied") return "danger" as const;
    return "default" as const;
  };

  const loadJobsAbortRef = useRef<AbortController | null>(null);

  const loadJobs = useCallback(async () => {
    if (!scopeId) {
      setPendingJobs([]);
      setFinishedJobs([]);
      setWorkers([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    // Cancel any in-flight request from a previous call.
    loadJobsAbortRef.current?.abort();
    const controller = new AbortController();
    loadJobsAbortRef.current = controller;
    try {
      const [jobsResult, workersResult] = await Promise.all([
        listJobs(scopeId, buildListJobsOptions(role, profile), controller.signal),
        canManageCompanyJobs ? listWorkers(scopeId) : Promise.resolve([]),
      ]);
      if (controller.signal.aborted) return;
      setPendingJobs(jobsResult.pending);
      setFinishedJobs(jobsResult.finished);
      setWorkers(workersResult);
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "Failed to load jobs");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [scopeId, canManageCompanyJobs, profile, role]);

  // Abort any outstanding request when the component unmounts.
  useEffect(() => () => { loadJobsAbortRef.current?.abort(); }, []);

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
    try {
      await deleteJob(scopeId, jobId);
      await loadJobs();
      toast({ title: "Job removed", variant: "info" });
    } catch (error) {
      toast({
        title: "Job delete failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <ProtectedRoute section="jobs">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Jobs
              </p>
              <h1 className="dashboard-title mt-5">
                {isSoloUser ? "My Jobs" : "Company Jobs"}
              </h1>
              <p className="dashboard-copy mt-4">
                {isSoloUser
                  ? "Create and manage your job workflow."
                  : "Manage pending and completed jobs, worker assignments, and status updates."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {pendingJobs.length}
                </p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Assigned</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {pendingAssignedCount}
                </p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Finished</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {finishedJobs.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {(isSoloUser || canManageCompanyJobs) ? (
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Create a new job</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Add core job details, then route the work to the right owner.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
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
                <Input
                  label="Client phone"
                  value={form.cphone}
                  onChange={(event) => setForm((prev) => ({ ...prev, cphone: event.target.value }))}
                />
                <Input
                  label="Location"
                  value={form.location}
                  onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                />
                <label className="md:col-span-2">
                  <span className="mb-1.5 inline-flex text-sm font-medium text-slate-700 dark:text-slate-200">
                    Description
                  </span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    rows={4}
                    className="dashboard-field min-h-28 resize-none"
                  />
                </label>
                {canManageCompanyJobs ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Assign worker</span>
                    <select
                      value={form.wid}
                      onChange={(event) => setForm((prev) => ({ ...prev, wid: event.target.value }))}
                      className="dashboard-field h-11"
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
                  <Button onClick={createNewJob} className="w-full md:w-auto">
                    Create job
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <UsersRound className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Queue snapshot</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Keep dispatch readable before jobs spill into manual follow-up.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">Waiting jobs</p>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {waitingCount} job{waitingCount === 1 ? " is" : "s are"} currently waiting.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">Assignment coverage</p>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {pendingAssignedCount} of {pendingJobs.length} pending jobs are assigned.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Workflow note
                  </p>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Status updates and assignment changes stay in the same queue instead of splitting across separate collections.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {loading ? <LoadingState /> : null}

        {!loading && loadError ? (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Couldn&apos;t load jobs</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{loadError}</p>
              </div>
              <Button onClick={() => void loadJobs()}>Retry</Button>
            </div>
          </Card>
        ) : null}

        {!loading && !loadError && pendingJobs.length === 0 && finishedJobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description={
              isSoloUser
                ? "Add your first job to start building a personal work history and document trail."
                : "Create the first company job to start tracking dispatch, ownership, and status in one queue."
            }
          />
        ) : null}

        {!loading && !loadError && pendingJobs.length > 0 ? (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Active queue</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Pending and in-progress work that still needs operational attention.
                </p>
              </div>
              <Badge variant="info">{pendingJobs.length} active</Badge>
            </div>
            <DataTable
              data={pendingJobs}
              columns={[
                {
                  key: "title",
                  header: "Job",
                  render: (row) => (
                    <div>
                      <p className="font-medium text-slate-950 dark:text-white">{row.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.cname}</p>
                    </div>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>,
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
                          className="dashboard-table-select"
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
                        className="dashboard-table-select"
                      >
                        {statusOptions.map((statusOption) => (
                          <option key={statusOption} value={statusOption}>
                            {statusOption}
                          </option>
                        ))}
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
          </Card>
        ) : null}

        {!loading && !loadError && finishedJobs.length > 0 ? (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Completed history</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Closed or denied work kept for visibility and follow-up.
                </p>
              </div>
              <Badge variant="success">{finishedJobs.length} archived</Badge>
            </div>
            <DataTable
              data={finishedJobs}
              columns={[
                {
                  key: "title",
                  header: "Job",
                  render: (row) => (
                    <div>
                      <p className="font-medium text-slate-950 dark:text-white">{row.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.cname}</p>
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
          </Card>
        ) : null}
      </section>
    </ProtectedRoute>
  );
}
