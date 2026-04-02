"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const resolvedId = id ?? props.name;
    const errorId = error && resolvedId ? `${resolvedId}-error` : undefined;
    return (
      <label className="flex w-full flex-col gap-1.5" htmlFor={resolvedId}>
        {label ? <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span> : null}
        <input
          ref={ref}
          id={resolvedId}
          className={cn(
            "h-11 w-full rounded-[1rem] border border-slate-300 bg-white/90 px-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100",
            error && "border-red-500 focus:border-red-500 focus:ring-red-500/20",
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          {...props}
        />
        {error ? (
          <span id={errorId} className="text-xs text-red-600">
            {error}
          </span>
        ) : null}
      </label>
    );
  },
);

Input.displayName = "Input";
