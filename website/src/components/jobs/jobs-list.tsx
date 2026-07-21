import Link from "next/link";
import { CalendarDays, MapPin, UserRound } from "lucide-react";
import type { Cursor, JobSummary } from "@smart-job/api-contracts";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/states/empty-state";
import {
  buildJobsPageHref,
  hasActiveJobsFilters,
  type JobsFilterValues,
} from "@/lib/dal/jobs-query";
import { formatDateTime } from "@/lib/format";

function statusVariant(status: JobSummary["status"]) {
  if (status === "finished") return "success" as const;
  if (status === "waiting") return "warning" as const;
  if (status === "denied") return "danger" as const;
  return "default" as const;
}

function jobLocation(job: JobSummary): string {
  return job.address ?? job.location ?? "No location";
}

function jobOwner(job: JobSummary): string {
  return job.assignee?.displayName
    ?? (job.assignee ? `Member ${job.assignee.memberNo}` : "Unassigned");
}

export function JobsList({
  companyId,
  jobs,
  filters,
  afterCursor,
  nextCursor,
}: {
  companyId: number;
  jobs: readonly JobSummary[];
  filters: JobsFilterValues;
  afterCursor: Cursor | null;
  nextCursor: Cursor | null;
}) {
  const firstPageHref = buildJobsPageHref(companyId, filters);
  const nextPageHref = nextCursor
    ? buildJobsPageHref(companyId, filters, nextCursor)
    : null;

  if (jobs.length === 0) {
    const filtered = hasActiveJobsFilters(filters) || afterCursor !== null;
    return (
      <EmptyState
        title={filtered ? "No jobs match these filters" : "No jobs yet"}
        description={filtered
          ? "Adjust the filters or return to the first page to continue browsing this workspace."
          : "Create the first job to begin tracking dispatch, ownership, and completed work in one queue."}
        action={filtered ? (
          <Link
            href={buildJobsPageHref(companyId)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Clear filters
          </Link>
        ) : undefined}
      />
    );
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Job results</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Showing {jobs.length} job{jobs.length === 1 ? "" : "s"} from this bounded page.
          </p>
        </div>
        {afterCursor ? <Badge variant="info">Continued page</Badge> : <Badge>First page</Badge>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold sm:px-6">Job</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Client</th>
              <th scope="col" className="px-4 py-3 font-semibold">Assignee</th>
              <th scope="col" className="px-5 py-3 font-semibold sm:px-6">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {jobs.map((job) => (
              <tr key={job.jobId} className="align-top transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                <td className="px-5 py-4 sm:px-6">
                  <p className="font-semibold text-slate-950 dark:text-white">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{job.jobNo}</span>{" "}
                    {job.title}
                  </p>
                  {job.description ? (
                    <p className="mt-1 max-w-md line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {job.description}
                    </p>
                  ) : null}
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {jobLocation(job)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                  {job.client?.name ?? "No client"}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {jobOwner(job)}
                  </span>
                </td>
                <td className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400 sm:px-6">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    <time dateTime={job.createdAt}><bdi dir="ltr">{formatDateTime(job.createdAt)}</bdi></time>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Jobs pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        {afterCursor ? (
          <Link
            href={firstPageHref}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            First page
          </Link>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Newest jobs first</span>
        )}

        {nextPageHref ? (
          <Link
            href={nextPageHref}
            rel="next"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            Next page
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-400 dark:bg-slate-900 dark:text-slate-600"
          >
            Next page
          </span>
        )}
      </nav>
    </Card>
  );
}
