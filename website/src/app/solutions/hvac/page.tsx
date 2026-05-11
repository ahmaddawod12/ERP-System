import Link from "next/link";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const revalidate = 3600;

const bullets = [
  "Dispatch preventive maintenance and emergency repair jobs quickly.",
  "Assign licensed technicians and preserve service logs by worker ID.",
  "Track filters, sensors, compressors, and parts with low-threshold alerts.",
  "Generate documents and compliance PDFs for clients after completion.",
];

export default function HvacSolutionPage() {
  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <p className="section-kicker">HVAC solution</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl dark:text-white">HVAC Operations Solution</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600 dark:text-slate-300">
          Coordinate installations, maintenance, and service calls with one mobile-first ERP system for HVAC businesses.
        </p>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">What teams get</h2>
            <ul className="mt-4 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              {bullets.map((item) => (
                <li key={item} className="quiet-list-item">
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900/70 dark:bg-blue-950/30">
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Ready to onboard your HVAC crew?</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Start with manager + worker roles, configure company profile, and begin assigning jobs in minutes.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/register">
                <Button variant="secondary">Create account</Button>
              </Link>
              <Link href="/contact">
                <Button variant="ghost">
                  Talk to sales
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
