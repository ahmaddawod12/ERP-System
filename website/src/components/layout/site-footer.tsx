import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 px-4 pb-8 pt-6 sm:px-6 lg:px-8">
      <div className="page-shell mesh-card overflow-hidden px-6 py-8 sm:px-8 sm:py-10">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p className="section-kicker">Built for service operations</p>
            <h2 className="mt-5 max-w-2xl text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl dark:text-white">
              Smart-Job ERP keeps dispatch, documents, inventory, and onboarding aligned across web and mobile.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              Designed for HVAC and field teams that need faster handoffs, protected writes, and cleaner operational visibility.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                Explore
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <Link href="/features" className="hover:text-slate-950 dark:hover:text-white">
                  Features
                </Link>
                <Link href="/pricing" className="hover:text-slate-950 dark:hover:text-white">
                  Pricing
                </Link>
                <Link href="/security" className="hover:text-slate-950 dark:hover:text-white">
                  Security
                </Link>
                <Link href="/docs" className="hover:text-slate-950 dark:hover:text-white">
                  Docs
                </Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                Company
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <Link href="/contact" className="hover:text-slate-950 dark:hover:text-white">
                  Contact
                </Link>
                <Link href="/privacy" className="hover:text-slate-950 dark:hover:text-white">
                  Privacy
                </Link>
                <Link href="/terms" className="hover:text-slate-950 dark:hover:text-white">
                  Terms
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-slate-200/70 pt-5 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>(c) {new Date().getFullYear()} Smart-Job ERP. Built for HVAC and field operations.</p>
          <div className="flex flex-wrap gap-2">
            <span className="data-pill">Realtime jobs</span>
            <span className="data-pill">Protected mutations</span>
            <span className="data-pill">RTL ready</span>
          </div>
        </div>
      </div>
    </footer>
  );
}


