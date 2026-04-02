import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const tiers = [
  {
    name: "Basic",
    audience: "Client and document essentials",
    features: ["Clients module", "Documents history", "Support email"],
  },
  {
    name: "Solo",
    audience: "Single owner workflows",
    features: ["My Jobs CRUD", "Personal Inventory", "Clients + Documents"],
  },
  {
    name: "Team",
    audience: "manager + worker collaboration",
    features: ["Worker assignments", "Company inventory", "Invites and role control"],
    featured: true,
  },
  {
    name: "Enterprise",
    audience: "Complex multi-site operations",
    features: ["All modules unlocked", "Priority support", "Customization pathway"],
  },
];

export default function PricingPage() {
  return (
    <PublicLayout>
      <section className="page-shell pb-14 pt-8 sm:pt-10">
        <div className="max-w-3xl">
          <p className="section-kicker">Pricing and rollout</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl dark:text-white">
            Choose how much operational depth your team needs right now.
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
            Checkout is not self-serve yet. Tiers are provisioned manually so access, role setup, and onboarding can stay aligned with your business model.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            [Sparkles, "Manual provisioning", "The rollout stays deliberate while the product matures."],
            [ShieldCheck, "Role-aware access", "Tiers map cleanly to the modules your team actually uses."],
            [ArrowRight, "Upgrade path", "Move up without rebuilding your data model or workflow."],
          ].map(([Icon, title, copy]) => (
            <div key={title as string} className="glass-panel rounded-[1.5rem] px-4 py-4">
              <Icon className="h-5 w-5 text-slate-950 dark:text-white" />
              <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{title as string}</p>
              <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{copy as string}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={[
                "flex flex-col rounded-[1.9rem] p-7",
                tier.featured
                  ? "border-none bg-[linear-gradient(160deg,#0f172a,#155e75)] text-white shadow-[0_28px_100px_-52px_rgba(8,145,178,0.9)] dark:bg-[linear-gradient(160deg,#67e8f9,#ecfeff)] dark:text-slate-950"
                  : "mesh-card",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  className={tier.featured ? "text-xl font-semibold text-white dark:text-slate-950" : "text-xl font-semibold text-slate-900 dark:text-slate-100"}
                >
                  {tier.name}
                </h2>
                {tier.featured ? (
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white dark:border-slate-950/10 dark:bg-slate-950/10 dark:text-slate-950">
                    Most adopted
                  </span>
                ) : null}
              </div>
              <p className={tier.featured ? "mt-1 text-sm text-slate-200 dark:text-slate-700" : "mt-1 text-sm text-slate-600 dark:text-slate-300"}>
                {tier.audience}
              </p>
              <ul className={tier.featured ? "mt-4 grid gap-2 text-sm text-slate-100 dark:text-slate-800" : "mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200"}>
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500 dark:text-emerald-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div
                className={
                  tier.featured
                    ? "mt-6 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-100 dark:border-slate-950/10 dark:bg-slate-950/10 dark:text-slate-800"
                    : "mt-6 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300"
                }
              >
                {tier.name === "Basic" ? "Entry scope" : tier.name === "Solo" ? "Owner-operator" : tier.name === "Team" ? "Dispatch + crew" : "Tailored rollout"}
              </div>
              <div className="mt-6">
                <Link href="/contact">
                  <Button
                    fullWidth
                    variant={tier.name === "Team" ? "primary" : "secondary"}
                    className={tier.featured ? "rounded-2xl bg-white text-slate-950 hover:bg-slate-100 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800" : "rounded-2xl"}
                  >
                    {tier.name === "Enterprise" ? "Contact sales" : "Request upgrade"}
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-10 grid gap-5 rounded-[2rem] p-7 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div>
            <p className="section-kicker">Need a guided rollout</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              If your team is between Solo and Enterprise, start with a conversation instead of guessing the tier.
            </h2>
          </div>
          <Link href="/contact">
            <Button size="lg" className="rounded-full px-6">
              Talk to sales <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>
      </section>
    </PublicLayout>
  );
}


