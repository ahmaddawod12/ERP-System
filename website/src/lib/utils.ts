import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function nowIso() {
  return new Date().toISOString();
}

export function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const length = 10;
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return code;
}

export function generateCompanySlug(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${normalized || "company"}-${suffix}`;
}

export function isRtlLocale(locale: string) {
  return locale === "he" || locale === "ar";
}
