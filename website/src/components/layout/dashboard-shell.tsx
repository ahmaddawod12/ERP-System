"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ClipboardList,
  FileText,
  Gauge,
  Settings,
  Users,
  Package,
  UserRound,
  TrendingUp,
  Boxes,
  Shield,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { canAccessSection, type AppSection } from "@/lib/access";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  section: AppSection;
  icon: React.ComponentType<{ className?: string }>;
}

function navItemsByRole(role: string): NavItem[] {
  if (role === "dev") {
    return [
      { label: "Overview", href: "/app", section: "overview", icon: Gauge },
      { label: "Jobs", href: "/app/jobs", section: "jobs", icon: BriefcaseBusiness },
      { label: "Workers", href: "/app/workers", section: "workers", icon: Users },
      { label: "Company Inventory", href: "/app/inventory", section: "inventory", icon: Boxes },
      { label: "Clients", href: "/app/clients", section: "clients", icon: UserRound },
      { label: "Documents", href: "/app/documents", section: "documents", icon: FileText },
      { label: "Settings", href: "/app/settings", section: "settings", icon: Settings },
      { label: "Upgrade", href: "/app/upgrade", section: "upgrade", icon: TrendingUp },
      { label: "Admin", href: "/app/admin", section: "admin", icon: Shield },
    ];
  }
  if (role === "manager") {
    return [
      { label: "Overview", href: "/app", section: "overview", icon: Gauge },
      { label: "Jobs", href: "/app/jobs", section: "jobs", icon: BriefcaseBusiness },
      { label: "Workers", href: "/app/workers", section: "workers", icon: Users },
      { label: "Company Inventory", href: "/app/inventory", section: "inventory", icon: Boxes },
      { label: "Clients", href: "/app/clients", section: "clients", icon: UserRound },
      { label: "Documents", href: "/app/documents", section: "documents", icon: FileText },
      { label: "Settings", href: "/app/settings", section: "settings", icon: Settings },
      { label: "Upgrade", href: "/app/upgrade", section: "upgrade", icon: TrendingUp },
    ];
  }
  if (role === "worker") {
    return [
      { label: "Overview", href: "/app", section: "overview", icon: Gauge },
      { label: "My Jobs", href: "/app/jobs", section: "jobs", icon: ClipboardList },
      { label: "Inventory Picks", href: "/app/inventory-picks", section: "inventoryPicks", icon: Package },
      { label: "Clients", href: "/app/clients", section: "clients", icon: UserRound },
      { label: "Documents", href: "/app/documents", section: "documents", icon: FileText },
      { label: "Settings", href: "/app/settings", section: "settings", icon: Settings },
      { label: "Upgrade", href: "/app/upgrade", section: "upgrade", icon: TrendingUp },
    ];
  }
  if (role === "user") {
    return [
      { label: "Overview", href: "/app", section: "overview", icon: Gauge },
      { label: "My Jobs", href: "/app/jobs", section: "jobs", icon: ClipboardList },
      { label: "Personal Inventory", href: "/app/inventory", section: "inventory", icon: Package },
      { label: "Clients", href: "/app/clients", section: "clients", icon: UserRound },
      { label: "Documents", href: "/app/documents", section: "documents", icon: FileText },
      { label: "Settings", href: "/app/settings", section: "settings", icon: Settings },
      { label: "Upgrade", href: "/app/upgrade", section: "upgrade", icon: TrendingUp },
    ];
  }
  return [
    { label: "Overview", href: "/app", section: "overview", icon: Gauge },
    { label: "Clients", href: "/app/clients", section: "clients", icon: UserRound },
    { label: "Documents", href: "/app/documents", section: "documents", icon: FileText },
    { label: "Settings", href: "/app/settings", section: "settings", icon: Settings },
    { label: "Upgrade", href: "/app/upgrade", section: "upgrade", icon: TrendingUp },
  ];
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, subscription, loading, logout } = useAuth();

  const tier = subscription?.tier ?? "Basic";

  const visibleNavItems = useMemo(() => {
    if (!profile) return [];
    return navItemsByRole(profile.role).filter((item) => canAccessSection(profile.role, tier, item.section));
  }, [profile, tier]);

  const activeSection = useMemo(
    () =>
      visibleNavItems.find((item) =>
        item.href === "/app" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`),
      ) ?? null,
    [pathname, visibleNavItems],
  );

  const upgradeRoute = visibleNavItems.find((item) => item.section === "upgrade")?.href ?? null;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const redirect = pathname ? `?redirect=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${redirect}`);
      return;
    }
    if (!profile || (!profile.companyId && profile.role !== "dev")) {
      router.replace("/onboarding");
    }
  }, [loading, pathname, profile, router, user]);

  if (loading) {
    return <LoadingState label="Preparing dashboard..." />;
  }

  if (!user || !profile || (!profile.companyId && profile.role !== "dev")) {
    return <LoadingState label="Redirecting..." />;
  }

  return (
    <div className="relative min-h-screen px-3 pb-4 pt-3 sm:px-4">
      <div className="absolute left-[-5rem] top-20 -z-10 h-56 w-56 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/18" />
      <div className="absolute bottom-10 right-[-4rem] -z-10 h-52 w-52 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/14" />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="dashboard-panel h-fit overflow-hidden p-3 sm:p-4 lg:sticky lg:top-3">
          <div className="rounded-[1.5rem] border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800 dark:bg-slate-900/45">
            <div className="mb-4 flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#0891b2,#0f172a)] text-sm font-bold tracking-[0.18em] text-white dark:bg-[linear-gradient(145deg,#22d3ee,#164e63)] dark:text-slate-950">
                SJ
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Smart-Job ERP</p>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Control surface
                </p>
              </div>
            </div>

            <div className="rounded-[1.3rem] border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/55">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {profile.name || profile.email}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>{profile.role}</Badge>
                <Badge variant="success">{tier}</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2 dark:bg-slate-900/65">
                  <span>Company</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{profile.companyId || "Pending"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2 dark:bg-slate-900/65">
                  <span>Section</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{activeSection?.label || "Overview"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
              Navigation
            </p>
            <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/app"
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-between gap-3 rounded-[1rem] px-3.5 py-3 text-sm font-medium transition-all lg:w-auto",
                      active
                        ? "bg-slate-950 text-white shadow-[0_16px_42px_-28px_rgba(15,23,42,0.95)] dark:bg-white dark:text-slate-950"
                        : "border border-transparent text-slate-700 hover:border-slate-200 hover:bg-white/75 dark:text-slate-200 dark:hover:border-slate-800 dark:hover:bg-slate-900/55",
                    )}
                  >
                    <span className="inline-flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                    <ArrowUpRight className={cn("hidden h-3.5 w-3.5 opacity-0 transition lg:block", active && "opacity-100")} />
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-5 rounded-[1.5rem] border border-slate-200/70 bg-[linear-gradient(145deg,rgba(8,145,178,0.1),rgba(15,23,42,0.02))] p-4 dark:border-slate-800 dark:bg-[linear-gradient(145deg,rgba(34,211,238,0.08),rgba(15,23,42,0.45))]">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-600 dark:text-slate-300">
              <Sparkles className="h-3.5 w-3.5" />
              Workspace state
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Access stays role-aware and tier-aware across jobs, clients, inventory, and document flows.
            </p>
            {upgradeRoute ? (
              <Link href={upgradeRoute} className="mt-4 inline-flex">
                <Button size="sm" className="rounded-full px-4">
                  Review plan
                </Button>
              </Link>
            ) : null}
          </div>

          <div className="mt-5 grid gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="dashboard-panel mb-4 flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                Current workspace
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                {activeSection?.label || "Overview"}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{profile.role}</Badge>
              <Badge variant="success">{tier}</Badge>
              <Badge variant="info">{profile.companyId || "No company yet"}</Badge>
            </div>
          </div>

          <div className="grid gap-4">{children}</div>
        </main>
      </div>
    </div>
  );
}
