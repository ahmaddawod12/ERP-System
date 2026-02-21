import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

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
      <section className="page-shell py-12">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Pricing (No Checkout Yet)</h1>
        <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
          Tiers are managed manually today. Use &quot;Request upgrade&quot; inside the app or contact the team.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card key={tier.name} className="flex flex-col">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{tier.name}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{tier.audience}</p>
              <ul className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link href="/contact">
                  <Button fullWidth variant={tier.name === "Team" ? "primary" : "secondary"}>
                    {tier.name === "Enterprise" ? "Contact sales" : "Request upgrade"}
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}


