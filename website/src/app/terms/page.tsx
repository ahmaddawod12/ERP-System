import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";

export const revalidate = 3600;

export default function TermsPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <Card>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Terms of Service</h1>
          <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">
            Smart-Job ERP is provided for lawful business operations. Account owners are responsible for team access, data quality, and invite sharing controls.
          </p>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Subscription tiers are currently managed manually. No in-app payments are collected on this website at this stage.
          </p>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Service availability depends on external infrastructure providers. We may update platform capabilities and documentation over time.
          </p>
        </Card>
      </section>
    </PublicLayout>
  );
}

