import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  emptyMessage = "No data yet.",
  className,
}: DataTableProps<T>) {
  const resolveRowKey = (row: T, rowIndex: number) => {
    if (typeof row === "object" && row !== null && "id" in row) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string" || typeof id === "number") {
        return String(id);
      }
    }
    return `row-${rowIndex}`;
  };

  if (!data.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950",
        className,
      )}
    >
      <table className="w-full min-w-[560px] text-left text-xs sm:min-w-[640px] sm:text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-3 py-2.5 font-semibold sm:px-4", column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-950">
          {data.map((row, rowIndex) => (
            <tr key={resolveRowKey(row, rowIndex)} className="transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/20">
              {columns.map((column) => (
                <td key={column.key} className={cn("px-3 py-2.5 align-middle sm:px-4", column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
