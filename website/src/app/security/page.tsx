import { Lock, ShieldCheck, UserRoundCheck } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";

const items = [
  {
    icon: ShieldCheck,
    title: "Firebase-backed auth + storage",
    description: "Email/password authentication with Firestore role-aware document access and scoped company data.",
  },
  {
    icon: UserRoundCheck,
    title: "Role and tier guards",
    description: "Manager, Worker, User, Basic, and Dev roles plus tier checks across routes and APIs.",
  },
  {
    icon: Lock,
    title: "Server-protected operations",
    description: "Invite validation, upgrade requests, and client counters run via API routes to reduce direct abuse risk.",
  },
];

export default function SecurityPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Security Overview</h1>
        <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
          Smart-Job ERP uses Firebase Authentication, Firestore security rules, and company-scoped data models with uid/companyId ownership.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {items.map((item) => (
            <Card key={item.title}>
              <item.icon className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>
        <Card className="mt-8">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Identity model</h2>
          <ul className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <li>Primary account identity: Firebase Auth `uid`</li>
            <li>Company context: `companyId`</li>
            <li>Worker assignments: `workerId` equals Firebase `uid`</li>
          </ul>
        </Card>
      </section>
    </PublicLayout>
  );
}

