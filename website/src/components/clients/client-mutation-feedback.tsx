"use client";

import { RefreshCw } from "lucide-react";
import type { ClientMutationMessage } from "./client-mutation-model";

export function ClientMutationFeedback({
  message,
  onReload,
}: {
  message: ClientMutationMessage | null;
  onReload?: () => void;
}) {
  return (
    <div aria-live="polite" className="min-h-5">
      {message ? (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error"
            ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
            : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"}
        >
          <p>{message.text}</p>
          {message.stale && onReload ? (
            <button
              type="button"
              onClick={onReload}
              className="mt-2 inline-flex items-center gap-1.5 font-semibold underline underline-offset-4"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reload latest client
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
