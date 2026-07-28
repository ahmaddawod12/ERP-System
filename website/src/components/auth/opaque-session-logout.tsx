"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

export function OpaqueSessionLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (pending) return;

    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setError("Your session could not be verified. Reload the page and try again.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "X-SJ-CSRF": csrfToken },
      });
      if (!response.ok) {
        setError("Sign out failed. Please try again.");
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={logout}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {pending ? "Signing out..." : "Sign out"}
      </button>
      {error ? <p role="alert" className="max-w-64 text-right text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
