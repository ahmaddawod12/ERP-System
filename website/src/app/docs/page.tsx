import Link from "next/link";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { docs } from "@/lib/docs";

export default function DocsIndexPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <p className="section-kicker">Docs</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">Documentation</h1>
        <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
          Product guides plus schema references, split module docs, and tabular API/database handoff sheets.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {docs.map((entry) => (
            <Link href={`/docs/${entry.slug}`} key={entry.slug}>
              <Card className="h-full transition hover:border-blue-400/50 hover:shadow-md">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{entry.title}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{entry.summary}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
