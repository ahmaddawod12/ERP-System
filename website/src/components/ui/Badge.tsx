import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const variants: Record<BadgeVariant, string> = {
  default: "border border-slate-200/80 bg-white/80 text-slate-700 dark:border-slate-700 dark:bg-slate-900/75 dark:text-slate-200",
  success: "border border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-200",
  warning: "border border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-200",
  danger: "border border-red-200/80 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-200",
  info: "border border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-900/30 dark:text-sky-200",
};

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium shadow-sm", variants[variant], className)}>
      {children}
    </span>
  );
}

