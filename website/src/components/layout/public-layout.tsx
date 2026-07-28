import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <MarketingNav />
      <main className="relative z-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
