export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="dashboard-panel flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-sky-400" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

