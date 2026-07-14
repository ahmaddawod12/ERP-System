import Link from "next/link";
import { ShieldX } from "lucide-react";

export default function CompanyNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <ShieldX className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">Workspace not available</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
          The company does not exist or is not included in your current memberships.
        </p>
        <Link
          href="/app/select-company"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          Select a workspace
        </Link>
      </div>
    </main>
  );
}
