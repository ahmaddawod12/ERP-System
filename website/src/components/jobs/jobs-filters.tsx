import Link from "next/link";
import type { JobsFilterValues } from "@/lib/dal/jobs-query";
import { buildJobsPageHref } from "@/lib/dal/jobs-query";
import { Card } from "@/components/ui/Card";

export function JobsFilters({
  companyId,
  filters,
  disabled = false,
}: {
  companyId: number;
  filters: JobsFilterValues;
  disabled?: boolean;
}) {
  const route = `/app/c/${companyId}/jobs`;

  return (
    <Card>
      <form action={route} method="get" aria-label="Filter jobs">
        <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr_1fr_1fr_auto] lg:items-end">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Search jobs</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Job number, title, client, location…"
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Status</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="waiting">Waiting</option>
              <option value="finished">Finished</option>
              <option value="denied">Denied</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Created from (UTC)</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom}
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Created to (UTC)</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo}
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:border-blue-700 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply filters
          </button>
        </fieldset>
      </form>

      {!disabled ? (
        <div className="mt-3 flex justify-end">
          <Link
            href={buildJobsPageHref(companyId)}
            className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Clear filters
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
