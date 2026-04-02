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
      <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[1.5rem] border border-white/70 bg-white/75 shadow-[0_20px_70px_-46px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/55",
        className,
      )}
    >
      <table className="w-full min-w-[560px] text-left text-xs sm:min-w-[640px] sm:text-sm">
        <thead className="bg-slate-50/85 text-slate-700 dark:bg-slate-900/85 dark:text-slate-300">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-3 py-3 font-semibold sm:px-4 sm:py-3.5", column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/80 bg-white/65 dark:divide-slate-800 dark:bg-slate-950/35">
          {data.map((row, rowIndex) => (
            <tr key={resolveRowKey(row, rowIndex)} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
              {columns.map((column) => (
                <td key={column.key} className={cn("px-3 py-3 align-top sm:px-4 sm:py-3.5", column.className)}>
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
