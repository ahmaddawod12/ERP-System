import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  buildClientsPageHref,
  type ClientsFilterValues,
} from "@/lib/dal/clients-query";

export function ClientsFilters({
  companyId,
  filters,
  disabled = false,
}: {
  companyId: number;
  filters: ClientsFilterValues;
  disabled?: boolean;
}) {
  const route = `/app/c/${companyId}/clients`;

  return (
    <Card>
      <form action={route} method="get" aria-label="Filter clients">
        <fieldset disabled={disabled} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Search clients</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Name, phone, email, city, or VAT number"
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:border-blue-700 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Search
          </button>
        </fieldset>
      </form>

      {!disabled ? (
        <div className="mt-3 flex justify-end">
          <Link
            href={buildClientsPageHref(companyId)}
            className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Clear search
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
