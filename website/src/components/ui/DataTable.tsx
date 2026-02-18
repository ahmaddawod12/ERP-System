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
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-4 py-3 font-semibold", column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-950/40">
          {data.map((row, rowIndex) => (
            <tr key={resolveRowKey(row, rowIndex)}>
              {columns.map((column) => (
                <td key={column.key} className={cn("px-4 py-3 align-top", column.className)}>
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
