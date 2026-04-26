import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Layers3,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench,
} from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const highlights = [
  {
    icon: Wrench,
    title: "Job lifecycle automation",
    description: "Track pending to completed jobs, assign workers, and keep every update synced in real time.",
  },
  {
    icon: Layers3,
    title: "Unified inventory",
    description: "Manage company and personal inventory with low stock thresholds and usage tracking.",
  },
  {
    icon: ShieldCheck,
    title: "Role + tier access control",
    description: "manager, worker, user, basic, and dev roles with subscription gating for every module.",
  },
];

const metrics = [
  { value: "3", label: "Languages with RTL-aware layout" },
  { value: "4", label: "Core job states kept in one flow" },
  { value: "24/7", label: "Shared visibility across web and mobile" },
];

const workflow = [
  {
    icon: UsersRound,
    title: "Capture the request",
    description: "Move from client details to a structured job record without email threads or spreadsheet drift.",
  },
  {
    icon: ClipboardList,
    title: "Dispatch with context",
    description: "Managers and workers see the same live status, assignment ownership, and inventory impact.",
  },
  {
    icon: FileText,
    title: "Finish with documents",
    description: "Generate PDFs and keep the job, customer, and document trail connected in one system.",
  },
];

const operationalRail = [
  "Jobs stay in one collection with explicit lifecycle status.",
  "Inventory is tracked from a single document model with next-id control.",
  "Protected writes flow through Cloud Functions instead of client-side mutation.",
];

export default function HomePage() {
  return (
    <PublicLayout>
      <section className="relative overflow-hidden pb-14 pt-8 sm:pb-18 sm:pt-12">
        <div className="page-shell">
          <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
            <div className="fade-in-up">
              <p className="section-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Smart-Job ERP for HVAC and field teams
              </p>
              <h1 className="section-title mt-6 max-w-4xl">
                Dispatch faster. Document every job. Keep the whole operation readable.
              </h1>
              <p className="section-copy mt-6 max-w-2xl">
                Smart-Job ERP gives service businesses a sharper operating system across jobs, clients, inventory, worker onboarding, and document generation, with one secure data model behind web and mobile.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register">
                  <Button
                    size="lg"
                    className="gap-2 rounded-full border border-cyan-400/50 bg-[linear-gradient(145deg,#0891b2,#0f172a)] px-6 text-white hover:bg-[linear-gradient(145deg,#0e7490,#020617)] dark:bg-[linear-gradient(145deg,#22d3ee,#164e63)] dark:text-slate-950"
                  >
                    Start free onboarding <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="secondary" className="rounded-full px-6">
                    Compare tiers
                  </Button>
                </Link>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {metrics.map((item) => (
                  <div key={item.label} className="glass-panel rounded-[1.5rem] px-4 py-4">
                    <p className="text-2xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
                      {item.value}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="fade-in-up lg:justify-self-end">
              <div className="mesh-card relative overflow-hidden p-5 sm:p-6">
                <div className="absolute right-5 top-5 h-24 w-24 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/20" />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                      Live control center
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                      Operational visibility without tab sprawl
                    </h2>
                  </div>
                  <span className="data-pill">Realtime sync</span>
                </div>

                <div className="mt-6 grid gap-4">
                  <div className="rounded-[1.6rem] border border-slate-200/70 bg-slate-950 px-4 py-4 text-white shadow-xl shadow-slate-950/10 dark:border-white/10 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Active jobs</p>
                        <p className="mt-2 text-3xl font-semibold tracking-[-0.05em]">28</p>
                      </div>
                      <div className="rounded-2xl bg-white/8 px-3 py-2 text-right text-xs text-slate-300">
                        <p>pending 12</p>
                        <p>waiting 9</p>
                        <p>finished 7</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                      <span className="rounded-full bg-white/8 px-3 py-2">Dispatch board</span>
                      <span className="rounded-full bg-white/8 px-3 py-2">Worker ownership</span>
                      <span className="rounded-full bg-white/8 px-3 py-2">Status trace</span>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] border border-slate-200/70 bg-white/88 p-4 dark:border-white/10 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Inventory pulse
                      </p>
                      <div className="mt-4 space-y-3">
                        {[
                          ["Compressors", "12 units"],
                          ["Filters", "Low stock"],
                          ["Copper fittings", "Ready"],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-4 text-sm text-slate-700 dark:text-slate-200">
                            <span>{label}</span>
                            <span className="font-medium text-slate-950 dark:text-white">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[1.4rem] border border-slate-200/70 bg-white/88 p-4 dark:border-white/10 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                        Document queue
                      </p>
                      <div className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <div className="flex items-center justify-between rounded-2xl bg-cyan-50 px-3 py-2 dark:bg-cyan-500/10">
                          <span>Invoice preview</span>
                          <span className="font-medium">Ready</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
                          <span>Tax invoice</span>
                          <span className="font-medium">Queued</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
                          <span>Service report</span>
                          <span className="font-medium">Sent</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell pb-16">
        <div className="glass-panel rounded-[2rem] px-5 py-5 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Why teams switch
              </p>
              <p className="mt-2 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300">
                Smart-Job ERP removes the split between office coordination and field execution.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {operationalRail.map((line) => (
                <span key={line} className="data-pill">
                  {line}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell pb-18">
        <div className="max-w-3xl">
          <p className="section-kicker">Core capabilities</p>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl dark:text-white">
            Built around the real rhythm of field service operations.
          </h2>
          <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
            Not generic CRM screens. The platform is shaped around dispatch, stock usage, worker coordination, and document output.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {highlights.map((item) => (
            <Card key={item.title} className="mesh-card border-white/70 p-7 dark:border-white/10">
              <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white dark:bg-white dark:text-slate-950">
                <item.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="page-shell pb-18">
        <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
          <Card className="mesh-card p-7 sm:p-8">
            <p className="section-kicker">Workflow clarity</p>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              Every handoff stays visible from intake to invoice.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              Managers can see the operational state. Workers can see their next action. Finance can see document output. That alignment is the product.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              {[
                "SQL-backed read model for jobs and workers",
                "Cloud Run PDF generation with queue-aware workflows",
                "Role and tier gating across routes and modules",
                "English, Hebrew, and Arabic support with RTL readiness",
              ].map((line) => (
                <div key={line} className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4">
            {workflow.map((item, index) => (
              <Card key={item.title} className="glass-panel rounded-[1.7rem] p-6">
                <div className="flex items-start gap-4">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      Step {index + 1}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell pb-24">
        <Card className="overflow-hidden rounded-[2rem] border-none bg-[linear-gradient(145deg,#0f172a,#0c4a6e,#0f172a)] px-6 py-8 text-white shadow-[0_30px_120px_-54px_rgba(14,116,144,0.9)] sm:px-8 sm:py-10 dark:bg-[linear-gradient(145deg,#e0f2fe,#67e8f9,#fef3c7)] dark:text-slate-950">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200 dark:text-sky-700">
                Ready to onboard
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Launch the web onboarding flow and bring the operational model online.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200 dark:text-slate-700">
                Registration stays on the website, provisioning runs through backend functions, and your team can move from setup into live work without rebuilding your workflow in spreadsheets.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg" className="rounded-full bg-white px-6 text-slate-950 hover:bg-slate-100 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800">
                  Create account
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="secondary" className="rounded-full border border-white/20 bg-white/10 px-6 text-white hover:bg-white/15 dark:border-slate-950/10 dark:bg-slate-950/10 dark:text-slate-950 dark:hover:bg-slate-950/20">
                  Talk to the team
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </section>
    </PublicLayout>
  );
}
