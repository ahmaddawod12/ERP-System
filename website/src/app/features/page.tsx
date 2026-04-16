import { ArrowRight, Clock3, FileText, Globe2, Package, Radio, UsersRound } from "lucide-react";
import Link from "next/link";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const features = [
  {
    icon: Clock3,
    title: "Jobs lifecycle",
    description: "Create, assign, and track jobs through their full lifecycle with worker ownership.",
  },
  {
    icon: Package,
    title: "Inventory tracking",
    description: "Support personal and company inventory, quantity thresholds, and worker pick consumption logs.",
  },
  {
    icon: UsersRound,
    title: "Client book",
    description: "Organize customers with scoped numeric IDs per company and structured contact details.",
  },
  {
    icon: FileText,
    title: "Document generation",
    description: "Queue documents and PDFs using API tasks with optional Cloud Run forwarding.",
  },
  {
    icon: Radio,
    title: "Realtime collaboration",
    description: "Firestore sync keeps manager and field workers aligned on status and assignments.",
  },
  {
    icon: Globe2,
    title: "Multi-language UX",
    description: "English, Hebrew, and Arabic support with RTL-aware layout and persisted preference.",
  },
];

const platformLanes = [
  {
    title: "Dispatch lane",
    description: "Jobs stay readable for managers and workers with status-driven workflow instead of scattered custom states.",
  },
  {
    title: "Inventory lane",
    description: "Stock movement stays attached to operational work instead of becoming a separate spreadsheet process.",
  },
  {
    title: "Document lane",
    description: "PDF creation, previews, and history remain tied back to the same client and job context.",
  },
];

export default function FeaturesPage() {
  return (
    <PublicLayout>
      <section className="page-shell pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="max-w-3xl">
          <p className="section-kicker">Platform features</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl dark:text-white">
            The website, dashboard, and mobile flow all revolve around the same operating model.
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
            Smart-Job ERP combines intake, dispatch, stock, customer context, and document output in one system designed for field-service businesses rather than generic back-office software.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Realtime", "Managers and workers stay aligned on status and ownership."],
            ["Unified", "Jobs, inventory, and documents stay connected instead of drifting apart."],
            ["Ready", "Role gating and multilingual UX support live rollout across teams."],
          ].map(([title, copy]) => (
            <div key={title} className="glass-panel rounded-[1.5rem] px-4 py-4">
              <p className="text-lg font-semibold text-slate-950 dark:text-white">{title}</p>
              <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{copy}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((item) => (
            <Card key={item.title} className="mesh-card p-7">
              <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white dark:bg-white dark:text-slate-950">
                <item.icon className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <Card className="mesh-card p-7 sm:p-8">
            <p className="section-kicker">System shape</p>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              A product that reads like an operations room, not a loose collection of modules.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              The architecture favors one canonical data model, protected writes, and a small number of clear status transitions so day-to-day work stays predictable.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="data-pill">Jobs lifecycle</span>
              <span className="data-pill">Inventory thresholds</span>
              <span className="data-pill">Cloud Run PDFs</span>
              <span className="data-pill">Auth + role gating</span>
            </div>
          </Card>

          <div className="grid gap-4">
            {platformLanes.map((lane, index) => (
              <Card key={lane.title} className="glass-panel rounded-[1.7rem] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                  Lane {index + 1}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{lane.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{lane.description}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card className="mt-10 overflow-hidden rounded-[2rem] border-none bg-[linear-gradient(145deg,#0f172a,#155e75,#0f172a)] px-6 py-8 text-white dark:bg-[linear-gradient(145deg,#e2e8f0,#67e8f9,#cffafe)] dark:text-slate-950 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200 dark:text-sky-700">
                See the rollout path
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Explore pricing and pick the operating scope that matches your team.
              </h2>
            </div>
            <Link href="/pricing">
              <Button size="lg" className="rounded-full bg-white px-6 text-slate-950 hover:bg-slate-100 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800">
                View pricing <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Card>
      </section>
    </PublicLayout>
  );
}

