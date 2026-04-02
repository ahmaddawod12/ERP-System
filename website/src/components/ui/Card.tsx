import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.6rem] border border-white/70 bg-white/84 p-6 shadow-[0_20px_70px_-46px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/62",
        className,
      )}
    >
      {children}
    </div>
  );
}

