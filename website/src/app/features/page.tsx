import { Clock3, FileText, Globe2, Package, Radio, UsersRound } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";

const features = [
  {
    icon: Clock3,
    title: "Jobs lifecycle",
    description: "Create, assign, and complete jobs from pending queues to finished history with worker ownership.",
  },
  {
    icon: Package,
    title: "Inventory tracking",
    description: "Support personal and company inventory, quantity thresholds, and worker pick consumption logs.",
  },
  {
    icon: UsersRound,
    title: "Client book",
    description: "Organize customers with scoped numeric IDs per company and structured contact details.",
  },
  {
    icon: FileText,
    title: "Document generation",
    description: "Queue certifications and PDFs using API tasks with optional Cloud Run forwarding.",
  },
  {
    icon: Radio,
    title: "Realtime collaboration",
    description: "Firestore sync keeps manager and field workers aligned on status and assignments.",
  },
  {
    icon: Globe2,
    title: "Multi-language UX",
    description: "English, Hebrew, and Arabic support with RTL-aware layout and persisted preference.",
  },
];

export default function FeaturesPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Platform Features</h1>
        <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
          Smart-Job ERP combines operations management and field execution in one workflow, optimized for HVAC and service teams.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((item) => (
            <Card key={item.title}>
              <item.icon className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

