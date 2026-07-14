import type {
  Cursor,
  WorkerMembershipStatus,
  WorkerSummary,
} from "@smart-job/api-contracts";
import { Mail, Phone, UserRound } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { WorkerMembershipActions } from "@/components/workers/worker-membership-actions";
import {
  buildWorkersPageHref,
  hasActiveWorkersFilters,
  type WorkersFilterValues,
} from "@/lib/dal/workers-query";

const memberDateFormatter = new Intl.DateTimeFormat("en-IL", { dateStyle: "medium" });

function statusVariant(status: WorkerMembershipStatus): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  return "danger";
}

export function WorkersList({
  companyId,
  workers,
  filters,
  afterCursor,
  nextCursor,
}: {
  companyId: number;
  workers: readonly WorkerSummary[];
  filters: WorkersFilterValues;
  afterCursor: Cursor | null;
  nextCursor: Cursor | null;
}) {
  const firstPageHref = buildWorkersPageHref(companyId, filters);
  const nextPageHref = nextCursor
    ? buildWorkersPageHref(companyId, filters, nextCursor)
    : null;

  if (workers.length === 0) {
    const filtered = hasActiveWorkersFilters(filters) || afterCursor !== null;
    return (
      <EmptyState
        title={filtered ? "No team members match these filters" : "No team members yet"}
        description={filtered
          ? "Try different filters or return to the first page of this directory."
          : "Create an invitation to onboard the first worker, user, or basic member."}
        action={filtered ? (
          <Link
            href={buildWorkersPageHref(companyId)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Clear filters
          </Link>
        ) : undefined}
      />
    );
  }

  const activeCount = workers.filter((worker) => worker.status === "active").length;
  const workerCount = workers.filter((worker) => worker.role === "worker").length;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Team directory</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Showing {workers.length} member{workers.length === 1 ? "" : "s"} from this bounded page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Current page team summary">
          <Badge>{workers.length} on page</Badge>
          <Badge variant="info">{workerCount} workers</Badge>
          <Badge variant="success">{activeCount} active</Badge>
          {afterCursor ? <Badge variant="warning">Continued page</Badge> : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-5 py-3 font-semibold sm:px-6">Member</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-5 py-3 font-semibold sm:px-6">Status</th>
              <th className="px-5 py-3 font-semibold sm:px-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {workers.map((worker) => (
              <tr
                key={worker.memberNo}
                className="align-top transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
              >
                <td className="px-5 py-4 sm:px-6">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <UserRound className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-white">
                        {worker.displayName ?? `Member ${worker.memberNo}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Member #{worker.memberNo}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="space-y-1.5 text-slate-600 dark:text-slate-300">
                    {worker.email ? (
                      <a href={`mailto:${worker.email}`} className="flex items-center gap-2 hover:text-blue-700 dark:hover:text-blue-300">
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        {worker.email}
                      </a>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">Email protected</span>
                    )}
                    {worker.phoneNumber ? (
                      <a href={`tel:${worker.phoneNumber}`} className="flex items-center gap-2 hover:text-blue-700 dark:hover:text-blue-300">
                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        {worker.phoneNumber}
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-4"><Badge variant="info">{worker.role}</Badge></td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                  <time dateTime={worker.joinedAt}>
                    {memberDateFormatter.format(new Date(worker.joinedAt))}
                  </time>
                </td>
                <td className="px-5 py-4 sm:px-6">
                  <Badge variant={statusVariant(worker.status)}>{worker.status}</Badge>
                </td>
                <td className="px-5 py-4 sm:px-6">
                  <WorkerMembershipActions companyId={companyId} worker={worker} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        aria-label="Team directory pagination"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6"
      >
        {afterCursor ? (
          <Link
            href={firstPageHref}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            First page
          </Link>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">First page</span>
        )}
        {nextPageHref ? (
          <Link
            href={nextPageHref}
            rel="next"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-3 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Next page
          </Link>
        ) : (
          <span aria-disabled="true" className="text-sm text-slate-400 dark:text-slate-600">
            End of directory
          </span>
        )}
      </nav>
    </Card>
  );
}
