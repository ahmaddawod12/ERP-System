import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  Package,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const capabilities = [
  {
    icon: CalendarDays,
    title: "Jobs & Dispatch",
    description: "Keep the schedule tight and the team moving.",
    points: ["Canonical job statuses", "Worker ownership", "Stable dispatch queue"],
  },
  {
    icon: Package,
    title: "Inventory Control",
    description: "Track stock before shortages reach the field.",
    points: ["Company and personal stock", "Low quantity alerts", "Usage history"],
  },
  {
    icon: FileText,
    title: "Documents That Work",
    description: "Generate professional docs from job context.",
    points: ["Quotes and invoices", "Preview before generate", "PDF task history"],
  },
  {
    icon: ShieldCheck,
    title: "Role-Aware Access",
    description: "Give every role the right view and nothing extra.",
    points: ["manager, worker, user", "Tier checks", "Company scope"],
  },
];

const dispatchRows = [
  ["#125548", "ABC Office Park", "pending", "Unassigned", "May 19, 8:00 AM"],
  ["#125549", "Riverside Mall", "waiting", "Mike Brown", "May 19, 11:00 AM"],
  ["#125550", "Westview Hospital", "pending", "Sara Lee", "May 19, 1:00 PM"],
  ["#125551", "Lakeside Office", "waiting", "Tom Davis", "May 19, 3:00 PM"],
  ["#125552", "Greenview Clinic", "finished", "Mike Brown", "May 18, 10:30 AM"],
];

const statusClass = (status: string) => {
  if (status === "finished") return "bg-emerald-500";
  if (status === "waiting") return "bg-amber-500";
  if (status === "denied") return "bg-red-500";
  return "bg-blue-600";
};

export default function HomePage() {
  return (
    <PublicLayout>
      <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell grid gap-10 py-14 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-16">
          <div className="fade-in-up">
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-normal text-slate-950 sm:text-6xl dark:text-white">
              Dispatch faster. Document every job. Keep the operation readable.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              Smart-Job ERP helps HVAC and service teams run a clean operation. Manage jobs from dispatch to close,
              track inventory, onboard workers, and generate professional documents without the busywork.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg" className="gap-2 px-5">
                  Start free onboarding <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button size="lg" variant="secondary" className="gap-2 px-5">
                  Compare tiers
                </Button>
              </Link>
            </div>

            <div className="mt-10 grid max-w-2xl gap-4 sm:grid-cols-4">
              {[
                [CheckCircle2, "Quick setup", "Get started in minutes"],
                [UsersRound, "Role-aware", "Right access for every role"],
                [ShieldCheck, "Secure by design", "Your data stays protected"],
                [FileText, "Documents", "Quotes, invoices, reports"],
              ].map(([Icon, title, copy]) => (
                <div key={title as string} className="grid gap-2">
                  <Icon className="h-6 w-6 text-slate-700 dark:text-slate-200" />
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">{title as string}</p>
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{copy as string}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="fade-in-up overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <span className="brand-mark h-8 w-8 text-xs">SJ</span>
                <div>
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">Smart-Job ERP</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Dispatch Board</p>
                </div>
              </div>
              <Button size="sm" className="gap-2">
                <Wrench className="h-4 w-4" />
                New job
              </Button>
            </div>

            <div className="grid min-h-[31rem] lg:grid-cols-[9rem_1fr]">
              <aside className="hidden border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60 lg:block">
                {["Dispatch", "Jobs", "Clients", "Inventory", "Workers", "Documents"].map((item, index) => (
                  <div
                    key={item}
                    className={[
                      "mb-1 rounded-lg px-3 py-2 text-xs font-medium",
                      index === 0
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                        : "text-slate-600 dark:text-slate-300",
                    ].join(" ")}
                  >
                    {item}
                  </div>
                ))}
              </aside>

              <div className="p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Dispatch Queue</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">May 19 - May 25</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="data-pill">All teams</span>
                    <span className="data-pill">All statuses</span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">Job No</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Client</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Worker</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Scheduled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {dispatchRows.map(([jobNo, client, status, worker, scheduled]) => (
                        <tr key={jobNo} className="bg-white dark:bg-slate-950">
                          <td className="px-3 py-2.5 font-medium text-slate-950 dark:text-white">{jobNo}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{client}</td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200">
                              <span className={`status-dot ${statusClass(status)}`} />
                              {status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{worker}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{scheduled}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {[
                    ["Job Status Queue", "pending 18", "waiting 9"],
                    ["Inventory Alerts", "R-410A low", "Capacitors low"],
                    ["Document Queue", "Quotes 9", "Invoices 11"],
                  ].map(([title, first, second]) => (
                    <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-sm font-semibold text-slate-950 dark:text-white">{title}</p>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <span>{first}</span>
                        <span>{second}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="page-shell py-14">
        <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div>
            <p className="section-kicker">Core capabilities</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl dark:text-white">
              Built around the real rhythm of field service operations.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              Not generic CRM screens. The platform is shaped around dispatch, stock usage, worker coordination, and document output.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {capabilities.map((item) => (
              <Card key={item.title}>
                <item.icon className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                <h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
                <ul className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                  {item.points.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {point}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell grid gap-8 py-14 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="section-kicker">Ready to onboard</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl dark:text-white">
              Launch the web onboarding flow and bring the operational model online.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              Registration stays on the website, provisioning runs through backend functions, and your team can move from setup into live work without rebuilding workflows in spreadsheets.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/register">
              <Button size="lg">Create account</Button>
            </Link>
            <Link href="/contact">
              <Button size="lg" variant="secondary">Talk to the team</Button>
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
