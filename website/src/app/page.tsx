import Link from "next/link";
import { ArrowRight, CheckCircle2, Layers3, ShieldCheck, Wrench } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

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
    description: "Manager, Worker, User, Basic, and Dev roles with subscription gating for every module.",
  },
];

export default function HomePage() {
  return (
    <PublicLayout>
      <section className="relative overflow-hidden pb-20 pt-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.25),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(34,197,94,0.2),transparent_30%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.35),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(34,197,94,0.25),transparent_30%)]" />
        <div className="page-shell">
          <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="inline-flex rounded-full border border-slate-300/80 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                Smart-Job ERP for HVAC and field teams
              </p>
              <h1 className="mt-4 text-4xl font-bold leading-tight text-slate-900 md:text-5xl dark:text-white">
                Cross-platform business management for modern service operations.
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
                Market your services faster, onboard workers with role-based access, and run jobs, clients, inventory, and PDF documentation from one secure Firebase-backed platform.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register">
                  <Button size="lg" className="gap-2">
                    Start free onboarding <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="secondary">
                    Compare tiers
                  </Button>
                </Link>
              </div>
            </div>

            <div className="glass-panel p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Product Preview</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Placeholder visual showing jobs, inventory levels, and document queue.
              </p>
              <div className="mt-5 grid gap-3">
                <div className="h-24 rounded-xl bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-emerald-500/20 p-3">
                  <p className="text-xs text-slate-700 dark:text-slate-200">Realtime Job Board</p>
                </div>
                <div className="h-24 rounded-xl bg-gradient-to-r from-emerald-500/20 via-lime-500/10 to-cyan-500/20 p-3">
                  <p className="text-xs text-slate-700 dark:text-slate-200">Inventory Alert Panel</p>
                </div>
                <div className="h-24 rounded-xl bg-gradient-to-r from-blue-500/20 via-cyan-500/10 to-sky-500/20 p-3">
                  <p className="text-xs text-slate-700 dark:text-slate-200">Certification Generator</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-shell pb-16">
        <div className="grid gap-4 md:grid-cols-3">
          {highlights.map((item) => (
            <Card key={item.title}>
              <item.icon className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="page-shell pb-20">
        <Card className="bg-gradient-to-br from-slate-900 to-cyan-900 text-white dark:from-slate-100 dark:to-cyan-100 dark:text-slate-900">
          <h2 className="text-2xl font-semibold">Built for field-service teams that move fast</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              "Realtime Firestore sync for jobs and workers",
              "Multi-language UX: English, Hebrew, Arabic (RTL)",
              "Cloud Run PDF generation workflow with fallback",
              "Tier gating ready for Basic, Solo, Team, Enterprise",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </PublicLayout>
  );
}

