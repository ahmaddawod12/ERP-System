import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { ContactForm } from "@/components/marketing/contact-form";

export const revalidate = 3600;

export default function ContactPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Contact</h1>
        <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
          Need a guided rollout, migration support, or enterprise access? Send us your details and we will respond.
        </p>
        <div className="mt-8 max-w-2xl">
          <Card>
            <ContactForm />
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}

