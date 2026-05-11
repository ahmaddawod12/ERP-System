import { ArrowRight, Clock3, FileText, Globe2, Package, Radio, UsersRound } from "lucide-react";
import Link from "next/link";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const features = [
  ["Jobs lifecycle", "Create, assign, and track jobs through their full lifecycle with worker ownership.", Clock3],
  ["Inventory tracking", "Support personal and company inventory, quantity thresholds, and worker pick consumption logs.", Package],
  ["Client book", "Organize customers with scoped numeric IDs per company and structured contact details.", UsersRound],
  ["Document generation", "Queue documents and PDFs using API tasks with optional Cloud Run forwarding.", FileText],
  ["Realtime collaboration", "SQL-backed read models keep manager and field workers aligned on status and assignments.", Radio],
  ["Multi-language UX", "English, Hebrew, and Arabic support with RTL-aware layout and persisted preference.", Globe2],
] as const;

const lanes = [
  ["Dispatch lane", "Jobs stay readable for managers and workers with status-driven workflow instead of scattered custom states."],
  ["Inventory lane", "Stock movement stays attached to operational work instead of becoming a separate spreadsheet process."],
  ["Document lane", "PDF creation, previews, and history remain tied back to the same client and job context."],
] as const;

export default function FeaturesPage() {
  return (
    <PublicLayout>
      <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell py-14">
          <div className="max-w-3xl">
            <p className="section-kicker">Platform features</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">
              The website, dashboard, and mobile flow all revolve around the same operating model.
            </h1>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              Smart-Job ERP combines intake, dispatch, stock, customer context, and document output in one system designed for field-service businesses.
            </p>
          </div>
        </div>
      </section>

      <section className="page-shell py-12">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, description, Icon]) => (
            <Card key={title}>
              <Icon className="h-6 w-6 text-blue-600 dark:text-blue-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <p className="section-kicker">System shape</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
              A product that reads like an operations room, not a loose collection of modules.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              The architecture favors one canonical data model, protected writes, and a small number of clear status transitions.
            </p>
          </Card>

          <div className="grid gap-4">
            {lanes.map(([title, description], index) => (
              <Card key={title} className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Lane {index + 1}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card className="mt-10 grid gap-5 border-blue-200 bg-blue-50 p-7 dark:border-blue-900/70 dark:bg-blue-950/30 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
              Explore pricing and pick the operating scope that matches your team.
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Move from solo work to team dispatch without rebuilding the data model.
            </p>
          </div>
          <Link href="/pricing">
            <Button size="lg" className="gap-2">
              View pricing <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>
      </section>
    </PublicLayout>
  );
}
