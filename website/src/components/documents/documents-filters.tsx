import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import {
  DOCUMENT_GENERATION_STATUS_OPTIONS,
  buildDocumentsPageHref,
  type DocumentsFilterValues,
} from "@/lib/dal/documents-query";

function statusLabel(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function DocumentsFilters({
  companyId,
  filters,
  disabled = false,
}: {
  companyId: number;
  filters: DocumentsFilterValues;
  disabled?: boolean;
}) {
  return (
    <Card>
      <form action={`/app/c/${companyId}/documents`} method="get" aria-label="Filter documents">
        <fieldset
          disabled={disabled}
          className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr_0.9fr_1fr_1fr_auto] xl:items-end"
        >
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Search documents</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Document number, code, or client..."
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
              {DOCUMENT_GENERATION_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Type</span>
            <select
              name="documentType"
              defaultValue={filters.documentType}
              className="dashboard-field h-10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">All types</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type.code} value={String(type.code)}>{type.label}</option>
              ))}
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
            href={buildDocumentsPageHref(companyId)}
            className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Clear filters
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
