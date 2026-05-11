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
    note: "Entry scope",
  },
  {
    name: "Solo",
    audience: "Single owner workflows",
    features: ["My Jobs CRUD", "Personal Inventory", "Clients + Documents"],
    note: "Owner-operator",
  },
  {
    name: "Team",
    audience: "manager + worker collaboration",
    features: ["Worker assignments", "Company inventory", "Invites and role control"],
    note: "Dispatch + crew",
    featured: true,
  },
  {
    name: "Enterprise",
    audience: "Complex multi-site operations",
    features: ["All modules unlocked", "Priority support", "Customization pathway"],
    note: "Tailored rollout",
  },
];

export default function PricingPage() {
  return (
    <PublicLayout>
      <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell py-14">
          <div className="max-w-3xl">
            <p className="section-kicker">Pricing and rollout</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">
              Choose how much operational depth your team needs right now.
            </h1>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              Checkout is not self-serve yet. Tiers are provisioned manually so access, role setup, and onboarding stay aligned with your business model.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              [Sparkles, "Manual provisioning", "The rollout stays deliberate while the product matures."],
              [ShieldCheck, "Role-aware access", "Tiers map cleanly to the modules your team actually uses."],
              [ArrowRight, "Upgrade path", "Move up without rebuilding your workflow."],
            ].map(([Icon, title, copy]) => (
              <Card key={title as string} className="p-5">
                <Icon className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{title as string}</p>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{copy as string}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell py-12">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={[
                "flex flex-col p-6",
                tier.featured
                  ? "border-blue-300 bg-blue-50 shadow-md shadow-blue-950/5 dark:border-blue-800 dark:bg-blue-950/30"
                  : "",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{tier.name}</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{tier.audience}</p>
                </div>
                {tier.featured ? <span className="data-pill border-blue-200 bg-white text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">Most adopted</span> : null}
              </div>
              <ul className="mt-5 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {tier.note}
              </div>
              <div className="mt-auto pt-6">
                <Link href="/contact">
                  <Button fullWidth variant={tier.featured ? "primary" : "secondary"}>
                    {tier.name === "Enterprise" ? "Contact sales" : "Request upgrade"}
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-10 grid gap-5 p-7 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
              If your team is between Solo and Enterprise, start with a conversation instead of guessing the tier.
            </h2>
          </div>
          <Link href="/contact">
            <Button size="lg" className="gap-2">
              Talk to sales <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>
      </section>
    </PublicLayout>
  );
}
