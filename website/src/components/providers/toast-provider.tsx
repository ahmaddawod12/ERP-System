"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (payload: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((payload: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { ...payload, id }]);
    window.setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-2xl flex-col gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto rounded-xl border p-4 shadow-lg backdrop-blur",
              item.variant === "success" && "border-emerald-500/40 bg-emerald-100/90 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100",
              item.variant === "error" && "border-red-500/40 bg-red-100/90 text-red-900 dark:bg-red-900/60 dark:text-red-100",
              item.variant === "info" && "border-sky-500/40 bg-sky-100/90 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100",
            )}
            role={item.variant === "error" ? "alert" : "status"}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{item.title}</p>
                {item.description ? <p className="text-sm opacity-90">{item.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

