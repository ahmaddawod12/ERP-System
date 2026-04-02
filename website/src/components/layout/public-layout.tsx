import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <div className="spotlight-ring pointer-events-none left-[-10rem] top-[-7rem] -z-20 h-[24rem] w-[24rem] bg-cyan-300/30 dark:bg-cyan-500/20" />
      <div className="spotlight-ring pointer-events-none right-[-6rem] top-24 -z-20 h-[18rem] w-[18rem] bg-amber-300/30 dark:bg-amber-500/20" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-30 h-[32rem] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.68),transparent_62%)] dark:bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.14),transparent_62%)]" />
      <MarketingNav />
      <main className="relative z-10">{children}</main>
      <SiteFooter />
    </div>
  );
}

