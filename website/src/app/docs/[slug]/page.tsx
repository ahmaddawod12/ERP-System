import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { docs, docsBySlug } from "@/lib/docs";

export function generateStaticParams() {
  return docs.map((entry) => ({ slug: entry.slug }));
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = docsBySlug[slug];
  if (!entry) notFound();

  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <div className="mb-4">
          <Link href="/docs" className="text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400">
            Back to docs
          </Link>
        </div>
        <Card>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{entry.title}</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">{entry.summary}</p>
          <ol className="mt-6 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
            {entry.body.map((line, index) => (
              <li key={line} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <span className="font-semibold">Step {index + 1}:</span> {line}
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </PublicLayout>
  );
}

