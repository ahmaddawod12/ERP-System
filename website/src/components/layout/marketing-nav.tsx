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

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
            SJ
          </span>
          <span>{t("common.appName")}</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
                pathname === link.href && "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white",
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
                <Button size="sm">{t("common.dashboard")}</Button>
              </Link>
              <Button size="sm" variant="secondary" onClick={() => logout()}>
                {t("common.logout")}
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button size="sm" variant="secondary">
                  {t("common.login")}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">{t("common.register")}</Button>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
          <div className="grid gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
                  <Button fullWidth>{t("common.dashboard")}</Button>
                </Link>
                <Button fullWidth variant="secondary" onClick={() => logout()}>
                  {t("common.logout")}
                </Button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button fullWidth variant="secondary">
                    {t("common.login")}
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setOpen(false)}>
                  <Button fullWidth>{t("common.register")}</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}

