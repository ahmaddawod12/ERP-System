import Link from "next/link";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const capabilities = [
  {
    title: "Multi-team dispatch",
    description: "Route different specialists to the right jobs while managers monitor progress in a shared queue.",
  },
  {
    title: "Client history",
    description: "Keep records of visits, notes, contact data, and generated documents by company scope.",
  },
  {
    title: "Inventory picks",
    description: "Workers reserve and consume parts in the field with quantity updates synced back to headquarters.",
  },
];

export default function FieldServicesSolutionPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Field Services Solution</h1>
        <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
          For plumbing, electrical, maintenance, and mixed field operations that need predictable service delivery.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {capabilities.map((item) => (
            <Card key={item.title}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>
        <Card className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Scale from solo owner to multi-worker team</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Start with the Solo tier and request Team upgrade when you add workers.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/pricing">
              <Button variant="secondary">View tiers</Button>
            </Link>
            <Link href="/register">
              <Button>Get started</Button>
            </Link>
          </div>
        </Card>
      </section>
    </PublicLayout>
  );
}

