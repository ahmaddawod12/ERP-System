import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  IBM_Plex_Mono,
  Noto_Sans_Hebrew,
  Noto_Sans_Arabic,
} from "next/font/google";
import { cookies } from "next/headers";
import { AppProviders } from "@/components/providers/app-providers";
import { locales, rtlLocales, type Locale } from "@/lib/i18n/translations";
import type { Theme } from "@/components/providers/theme-provider";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const hebrew = Noto_Sans_Hebrew({
  variable: "--font-hebrew",
  subsets: ["hebrew"],
  weight: ["400", "500", "700"],
});

const arabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Smart-Job ERP Website",
  description:
    "Production-ready SaaS website for Smart-Job ERP with onboarding, role-based dashboard, docs, and admin tooling.",
};

const preferenceBootstrapScript = `(() => {
  try {
    const doc = document.documentElement;
    const readCookie = (key) => {
      const pattern = new RegExp("(?:^|; )" + key.replace(/[.$?*|{}()\\[\\]\\\\/+^]/g, "\\\\$&") + "=([^;]*)");
      const match = document.cookie.match(pattern);
      return match ? decodeURIComponent(match[1]) : null;
    };

    const themeFromCookie = readCookie("sj_theme");
    const themeFromStorage = window.localStorage.getItem("sj_theme");
    const theme =
      themeFromCookie === "dark" || themeFromCookie === "light"
        ? themeFromCookie
        : themeFromStorage === "dark" || themeFromStorage === "light"
          ? themeFromStorage
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";

    doc.classList.toggle("dark", theme === "dark");
    doc.style.colorScheme = theme;

    const localeFromCookie = readCookie("sj_locale");
    const localeFromStorage = window.localStorage.getItem("sj_locale");
    const locale =
      localeFromCookie === "en" || localeFromCookie === "he" || localeFromCookie === "ar"
        ? localeFromCookie
        : localeFromStorage === "en" || localeFromStorage === "he" || localeFromStorage === "ar"
          ? localeFromStorage
          : "en";

    doc.lang = locale;
    doc.dir = locale === "he" || locale === "ar" ? "rtl" : "ltr";
  } catch {}
})();`;

function resolveLocale(raw: string | undefined): Locale {
  return locales.includes(raw as Locale) ? (raw as Locale) : "en";
}

function resolveTheme(raw: string | undefined): Theme {
  return raw === "dark" ? "dark" : "light";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLocale = resolveLocale(cookieStore.get("sj_locale")?.value);
  const initialTheme = resolveTheme(cookieStore.get("sj_theme")?.value);
  const isRtl = rtlLocales.includes(initialLocale);

  return (
    <html
      lang={initialLocale}
      dir={isRtl ? "rtl" : "ltr"}
      data-scroll-behavior="smooth"
      className={initialTheme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceBootstrapScript }} />
      </head>
      <body
        className={`${sans.variable} ${mono.variable} ${hebrew.variable} ${arabic.variable} min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100`}
      >
        <a className="skip-navigation" href="#main-content">
          Skip to main content
        </a>
        <AppProviders initialLocale={initialLocale} initialTheme={initialTheme}>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
