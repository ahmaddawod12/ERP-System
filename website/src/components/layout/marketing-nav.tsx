"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { ThemeToggle } from "@/components/marketing/theme-toggle";

const links = [
  { href: "/", key: "nav.home" },
  { href: "/features", key: "nav.features" },
  { href: "/solutions/hvac", key: "nav.hvac" },
  { href: "/solutions/field-services", key: "nav.fieldServices" },
  { href: "/pricing", key: "nav.pricing" },
  { href: "/security", key: "nav.security" },
  { href: "/docs", key: "nav.docs" },
  { href: "/contact", key: "nav.contact" },
];

export function MarketingNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 px-3 py-3 sm:px-5">
      <div className="mx-auto flex w-full max-w-[82rem] items-center justify-between gap-4 rounded-[1.4rem] border border-white/70 bg-white/78 px-4 py-3 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.8)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70 sm:px-5 lg:px-6">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#0891b2,#0f172a)] text-sm font-bold tracking-[0.2em] text-white shadow-lg shadow-cyan-500/20 dark:bg-[linear-gradient(145deg,#22d3ee,#0f172a)]">
            SJ
          </span>
          <span className="flex flex-col">
            <span>{t("common.appName")}</span>
            <span className="text-[0.65rem] font-medium uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Field operations OS
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
                isActive(link.href) && "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
              )}
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          {user ? (
            <>
              <Link href="/app">
                <Button size="sm" className="rounded-full px-4">
                  {t("common.dashboard")}
                </Button>
              </Link>
              <Button size="sm" variant="secondary" className="rounded-full px-4" onClick={() => logout()}>
                {t("common.logout")}
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button size="sm" variant="secondary" className="rounded-full px-4">
                  {t("common.login")}
                </Button>
              </Link>
              <Link href="/register">
                <Button
                  size="sm"
                  className="rounded-full border border-cyan-400/50 bg-[linear-gradient(145deg,#0891b2,#0f172a)] px-4 text-white hover:bg-[linear-gradient(145deg,#0e7490,#020617)] dark:bg-[linear-gradient(145deg,#22d3ee,#164e63)] dark:text-slate-950"
                >
                  {t("common.register")}
                </Button>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/70 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="mx-3 mt-2 rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.7)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90 lg:hidden">
          <div className="grid gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                  isActive(link.href) && "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
                )}
                onClick={() => setOpen(false)}
              >
                {t(link.key)}
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          <div className="mt-4 grid gap-2">
            {user ? (
              <>
                <Link href="/app" onClick={() => setOpen(false)}>
                  <Button fullWidth className="rounded-2xl">
                    {t("common.dashboard")}
                  </Button>
                </Link>
                <Button fullWidth variant="secondary" className="rounded-2xl" onClick={() => logout()}>
                  {t("common.logout")}
                </Button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button fullWidth variant="secondary" className="rounded-2xl">
                    {t("common.login")}
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setOpen(false)}>
                  <Button
                    fullWidth
                    className="rounded-2xl border border-cyan-400/50 bg-[linear-gradient(145deg,#0891b2,#0f172a)] text-white hover:bg-[linear-gradient(145deg,#0e7490,#020617)] dark:bg-[linear-gradient(145deg,#22d3ee,#164e63)] dark:text-slate-950"
                  >
                    {t("common.register")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}

