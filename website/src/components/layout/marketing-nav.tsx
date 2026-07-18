"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/hooks/use-i18n";
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
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/92">
      <div className="page-shell flex min-h-16 items-center justify-between gap-4 py-2">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
          <span className="brand-mark">
            SJ
          </span>
          <span className="flex flex-col">
            <span>{t("common.appName")}</span>
            <span className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Field operations OS
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white",
                isActive(link.href) && "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
              )}
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          <Link href="/app">
            <Button size="sm" className="px-4">
              {t("common.dashboard")}
            </Button>
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900 lg:hidden"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="mx-3 mb-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
          <div className="grid gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900",
                  isActive(link.href) && "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
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
            <Link href="/app" onClick={() => setOpen(false)}>
              <Button fullWidth>
                {t("common.dashboard")}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
