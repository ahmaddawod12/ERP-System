import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white/70 py-10 dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-4 px-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:px-6 lg:px-8 dark:text-slate-300">
        <p>© {new Date().getFullYear()} Smart-Job ERP. Built for HVAC and field operations.</p>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-slate-900 dark:hover:text-white">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-slate-900 dark:hover:text-white">
            Terms
          </Link>
          <Link href="/contact" className="hover:text-slate-900 dark:hover:text-white">
            Contact
          </Link>
        </div>
      </div>
    </footer>
  );
}

