import Link from "next/link";
import { Package, TriangleAlert } from "lucide-react";
import type {
  Cursor,
  InventoryPartStatus,
  InventoryPartSummary,
} from "@smart-job/api-contracts";
import { InventoryRowActions } from "@/components/inventory/inventory-row-actions";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  buildInventoryPageHref,
  hasActiveInventoryFilters,
  type InventoryFilterValues,
  type InventoryReadScope,
} from "@/lib/dal/inventory-query";

const quantityFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

function statusVariant(status: InventoryPartStatus): "success" | "default" | "warning" {
  if (status === "active") return "success";
  if (status === "archived") return "warning";
  return "default";
}

function quantityLabel(value: number, unit: string | null): string {
  return `${quantityFormatter.format(value)}${unit ? ` ${unit}` : ""}`;
}

export function InventoryList({
  companyId,
  scope,
  parts,
  filters,
  afterCursor,
  nextCursor,
  canManageInventory,
}: {
  companyId: number;
  scope: InventoryReadScope;
  parts: readonly InventoryPartSummary[];
  filters: InventoryFilterValues;
  afterCursor: Cursor | null;
  nextCursor: Cursor | null;
  canManageInventory: boolean;
}) {
  const firstPageHref = buildInventoryPageHref(companyId, filters);
  const nextPageHref = nextCursor
    ? buildInventoryPageHref(companyId, filters, nextCursor)
    : null;

  if (parts.length === 0) {
    const filtered = hasActiveInventoryFilters(filters) || afterCursor !== null;
    return (
      <EmptyState
        title={filtered ? "No parts match these filters" : "No inventory parts yet"}
        description={filtered
          ? "Try different search or status filters, or return to the first page."
          : scope === "member"
            ? "Parts assigned to your personal stock will appear here."
            : "Company stock will appear here after inventory parts are added."}
        action={filtered ? (
          <Link
            href={buildInventoryPageHref(companyId)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Clear filters
          </Link>
        ) : undefined}
      />
    );
  }

  const lowStockCount = parts.filter((part) => (
    part.status === "active" && part.quantity <= part.lowThreshold
  )).length;
  const scopeLabel = scope === "member" ? "Assigned stock" : "Company stock";

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{scopeLabel}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Showing {parts.length} part{parts.length === 1 ? "" : "s"} from this bounded page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Current inventory page summary">
          <Badge>{parts.length} on page</Badge>
          <Badge variant={lowStockCount > 0 ? "warning" : "success"}>{lowStockCount} low stock</Badge>
          {afterCursor ? <Badge variant="info">Continued page</Badge> : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-5 py-3 font-semibold sm:px-6">Part</th>
              <th className="px-4 py-3 font-semibold">Quantity</th>
              <th className="px-4 py-3 font-semibold">Low threshold</th>
              <th className="px-4 py-3 font-semibold">Updated</th>
              <th className="px-5 py-3 font-semibold sm:px-6">Status</th>
              <th className="px-5 py-3 text-right font-semibold sm:px-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {parts.map((part) => {
              const isLowStock = part.status === "active" && part.quantity <= part.lowThreshold;
              return (
                <tr key={part.partId} className="align-top transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                  <td className="px-5 py-4 sm:px-6">
                    <p className="inline-flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                      <Package className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      <span>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{part.partNo}</span>{" "}
                        {part.name}
                      </span>
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={isLowStock
                      ? "inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300"
                      : "font-semibold text-slate-900 dark:text-slate-100"}
                    >
                      {isLowStock ? <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {quantityLabel(part.quantity, part.unit)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                    {quantityLabel(part.lowThreshold, part.unit)}
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                    <time dateTime={part.updatedAt}>{dateFormatter.format(new Date(part.updatedAt))}</time>
                  </td>
                  <td className="px-5 py-4 sm:px-6">
                    <Badge variant={statusVariant(part.status)}>{part.status}</Badge>
                  </td>
                  <td className="px-5 py-4 text-right sm:px-6">
                    {canManageInventory ? (
                      <InventoryRowActions companyId={companyId} part={part} />
                    ) : (
                      <span className="text-xs text-slate-400" aria-disabled="true">Read only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav aria-label="Inventory pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        {afterCursor ? (
          <Link
            href={firstPageHref}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            First page
          </Link>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Newest parts first</span>
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
