import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const variants: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
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
    <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}

