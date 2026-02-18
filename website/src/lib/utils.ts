import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function nowIso() {
  return new Date().toISOString();
}

export function generateInviteCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function generateCompanySlug(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${normalized || "company"}-${suffix}`;
}

export function isRtlLocale(locale: string) {
  return locale === "he" || locale === "ar";
}

