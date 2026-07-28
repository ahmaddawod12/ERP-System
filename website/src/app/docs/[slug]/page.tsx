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
          <Link href="/docs" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
            Back to docs
          </Link>
        </div>
        <Card>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{entry.title}</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">{entry.summary}</p>
          {entry.body.length > 0 ? (
            <ul className="mt-6 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              {entry.body.map((line) => (
                <li key={line} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {entry.tables?.map((table) => (
            <div key={table.title} className="mt-6">
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">{table.title}</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-700">
                  <thead className="bg-slate-50 dark:bg-slate-900/40">
                    <tr>
                      {table.columns.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {table.rows.map((row, rowIndex) => (
                      <tr key={`${table.title}-${rowIndex}`}>
                        {row.map((value, cellIndex) => (
                          <td
                            key={`${table.title}-${rowIndex}-${cellIndex}`}
                            className="px-3 py-2 align-top text-slate-700 dark:text-slate-200"
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {entry.links?.length ? (
            <div className="mt-6 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Related Docs
              </h2>
              <ul className="grid gap-2 text-sm">
                {entry.links.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-blue-700 hover:underline dark:text-blue-300">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </section>
    </PublicLayout>
  );
}
