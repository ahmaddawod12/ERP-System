import { CheckCircle2, Lock, ShieldCheck, UserRoundCheck } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";

export const revalidate = 3600;

const items = [
  {
    icon: ShieldCheck,
    title: "Supabase-backed auth",
    description: "Email/password authentication with SQL-backed runtime data access and scoped company boundaries.",
  },
  {
    icon: UserRoundCheck,
    title: "Role and tier guards",
    description: "manager, worker, user, basic, and dev roles plus tier checks across routes and APIs.",
  },
  {
    icon: Lock,
    title: "Server-protected operations",
    description: "Invite validation, upgrade requests, and client counters run via API routes to reduce direct abuse risk.",
  },
];

const principles = [
  "Supabase auth uid is the account identity.",
  "companyId scopes business data and is allocated server-side.",
  "Protected collections are mutated by backend flows, not client writes.",
  "Canonical status and field naming reduce schema drift across surfaces.",
];

export default function SecurityPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <div className="max-w-3xl">
          <p className="section-kicker">Security overview</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">
            Secure by data model, role boundaries, and protected write paths.
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
            Smart-Job ERP uses Supabase Authentication, SQL-backed backend flows, and backend-only mutation boundaries so account identity, company scope, and operational writes stay explicit.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["uid", "Primary user identity across all user-scoped data."],
            ["companyId", "Server-allocated business scope, never derived from email."],
            ["Cloud Functions", "Protected writes for jobs, clients, documents, workers, and invites."],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <p className="text-lg font-semibold text-slate-950 dark:text-white">{title}</p>
              <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{copy}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((item) => (
            <Card key={item.title} className="p-7">
              <item.icon className="h-6 w-6 text-blue-600 dark:text-blue-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <Card className="p-7 sm:p-8">
            <p className="section-kicker">Architecture notes</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
              Identity and company scope are separate on purpose.
            </h2>
            <ul className="mt-6 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <li className="quiet-list-item flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                <span>Primary account identity: Supabase auth uid.</span>
              </li>
              <li className="quiet-list-item flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                <span>Company context: companyId allocated by backend registration.</span>
              </li>
              <li className="quiet-list-item flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                <span>Worker records use sequential wid values inside a company scope.</span>
              </li>
            </ul>
          </Card>

          <Card className="p-7 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Guardrails
            </p>
            <div className="mt-5 grid gap-3">
              {principles.map((principle) => (
                <div key={principle} className="quiet-list-item leading-7">
                  {principle}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
