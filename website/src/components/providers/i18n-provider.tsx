"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { languageLabels, locales, rtlLocales, translations, type Locale } from "@/lib/i18n/translations";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string) => string;
  isRtl: boolean;
  languageLabels: Record<Locale, string>;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "sj_locale";

function resolvePath(locale: Locale, path: string) {
  const parts = path.split(".");
  let cursor: unknown = translations[locale];
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || !(part in cursor)) {
      return path;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : path;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && locales.includes(stored as Locale)) {
      setLocaleState(stored as Locale);
    }
  }, []);

  useEffect(() => {
    const rtl = rtlLocales.includes(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.cookie = `sj_locale=${locale}; path=/; max-age=31536000`;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (next) => setLocaleState(next),
      t: (path) => resolvePath(locale, path),
      isRtl: rtlLocales.includes(locale),
      languageLabels,
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
}

