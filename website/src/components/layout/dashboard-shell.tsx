"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
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
  if (role === "Dev") {
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
  if (role === "Manager") {
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
  if (role === "Worker") {
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
  if (role === "User") {
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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const redirect = pathname ? `?redirect=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${redirect}`);
      return;
    }
    if (!profile) {
      router.replace("/onboarding");
    }
  }, [loading, pathname, profile, router, user]);

  if (loading) {
    return <LoadingState label="Preparing dashboard..." />;
  }

  if (!user || !profile) {
    return <LoadingState label="Redirecting..." />;
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-slate-200 bg-white/80 p-4 backdrop-blur lg:border-b-0 lg:border-r dark:border-slate-800 dark:bg-slate-950/60">
        <div className="mb-6 flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
            SJ
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Smart-Job ERP</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Badge>{profile.role}</Badge>
          <Badge variant="success">{tier}</Badge>
        </div>

        <nav className="grid gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 grid gap-2">
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

      <main className="bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.14),transparent_40%)] p-4 sm:p-6 lg:p-8 dark:bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.2),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(2,132,199,0.2),transparent_40%)]">
        {children}
      </main>
    </div>
  );
}
