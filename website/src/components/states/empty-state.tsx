import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed border-slate-300/90 bg-white/70 px-5 py-8 text-center dark:border-slate-700 dark:bg-slate-950/45 sm:px-6">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
        <Inbox className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

