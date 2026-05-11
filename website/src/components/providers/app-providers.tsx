"use client";

import { AuthProvider } from "@/components/providers/auth-provider";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { ThemeProvider, type Theme } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import type { Locale } from "@/lib/i18n/translations";

export function AppProviders({
  children,
  initialLocale,
  initialTheme,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
  initialTheme: Theme;
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <I18nProvider initialLocale={initialLocale}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
