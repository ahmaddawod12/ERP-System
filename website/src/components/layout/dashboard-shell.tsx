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
  Search,
  Bell,
  HelpCircle,
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:sticky lg:top-0 lg:h-screen">
          <div className="border-b border-slate-200 p-4 dark:border-slate-800">
            <div className="mb-4 flex items-center gap-3">
              <div className="brand-mark">
                SJ
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Smart-Job ERP</p>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Control surface
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {profile.name || profile.email}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>{profile.role}</Badge>
                <Badge variant="success">{tier}</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 dark:bg-slate-950">
                  <span>Company</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{profile.companyId || "Pending"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 dark:bg-slate-950">
                  <span>Section</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{activeSection?.label || "Overview"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4">
            <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
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
                      "inline-flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all lg:w-auto",
                      active
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                        : "border border-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900",
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

          <div className="mx-4 mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">
              <Sparkles className="h-3.5 w-3.5" />
              Workspace state
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Access stays role-aware and tier-aware across jobs, clients, inventory, and document flows.
            </p>
            {upgradeRoute ? (
              <Link href={upgradeRoute} className="mt-4 inline-flex">
                <Button size="sm" className="px-4">
                  Review plan
                </Button>
              </Link>
            ) : null}
          </div>

          <div className="mt-auto grid gap-2 p-4">
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
          <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/92 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Current workspace
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-normal text-slate-950 dark:text-white">
                {activeSection?.label || "Overview"}
              </h1>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <div className="hidden h-10 min-w-[18rem] max-w-md flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 lg:flex">
                <Search className="h-4 w-4" />
                <span>Search jobs, clients, workers...</span>
              </div>
              <Button variant="secondary" size="sm" aria-label="Notifications">
                <Bell className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="sm" aria-label="Help">
                <HelpCircle className="h-4 w-4" />
              </Button>
              <Badge>{profile.role}</Badge>
              <Badge variant="success">{tier}</Badge>
            </div>
          </div>

          <div className="grid gap-4 p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
