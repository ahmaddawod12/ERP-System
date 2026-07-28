import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  buildInventoryPageHref,
  type InventoryFilterValues,
} from "@/lib/dal/inventory-query";

export function InventoryFilters({
  companyId,
  filters,
  disabled = false,
}: {
  companyId: number;
  filters: InventoryFilterValues;
  disabled?: boolean;
}) {
  const route = `/app/c/${companyId}/inventory`;

  return (
    <Card>
      <form action={route} method="get" aria-label="Filter inventory">
        <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Search inventory</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Part name or number"
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Status</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Current parts</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
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
            href={buildInventoryPageHref(companyId)}
            className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Clear filters
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
