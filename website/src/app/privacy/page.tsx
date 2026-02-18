import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";

export default function PrivacyPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <Card>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Privacy Policy</h1>
          <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">
            Smart-Job ERP stores account and company data required for service management. We use Firebase services for authentication, database storage, and secure data processing.
          </p>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Personal information includes account email, profile name, phone, and company context. Operational records may include job details, inventory updates, client records, and generated documents.
          </p>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Access is controlled by role and subscription tier. You can request data updates or account support through the contact page.
          </p>
        </Card>
      </section>
    </PublicLayout>
  );
}

