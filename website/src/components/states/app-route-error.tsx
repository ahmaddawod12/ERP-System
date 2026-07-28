"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function AppRouteError({
  reset,
  title = "We could not load this workspace",
}: {
  reset: () => void;
  title?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/70 dark:bg-slate-950">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
          Your session is safe. Retry the request, or return to workspace selection if the issue continues.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>Try again</Button>
          <Link
            href="/app/select-company"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Select workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
