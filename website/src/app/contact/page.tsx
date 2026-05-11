import { Clock3, ShieldCheck, Wrench } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { ContactForm } from "@/components/marketing/contact-form";

export const revalidate = 3600;

export default function ContactPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="section-kicker">Contact</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">
              Reach the team for rollout planning, migration help, or enterprise access.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-600 dark:text-slate-300">
              Use the form to tell us how your operation works today, what modules you need first, and where you want help. We will reply with a realistic next step.
            </p>

            <div className="mt-8 grid gap-4">
              {[
                [Clock3, "Response rhythm", "Contact requests are reviewed manually to match the right rollout path."],
                [ShieldCheck, "Protected setup", "Provisioning and company-scoped setup are handled server-side."],
                [Wrench, "Field-service focus", "Best fit for HVAC and teams running dispatch-heavy workflows."],
              ].map(([Icon, title, copy]) => (
                <div key={title as string} className="quiet-list-item">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-white">{title as string}</p>
                      <p className="mt-1 leading-7 text-slate-600 dark:text-slate-300">{copy as string}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Card className="p-6 sm:p-8">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Tell us about your setup
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                Share your workflow and we will respond with the right onboarding path.
              </h2>
            </div>
            <ContactForm />
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
