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
        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">HVAC Operations Solution</h1>
        <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
          Coordinate installations, maintenance, and service calls with one mobile-first ERP system for HVAC businesses.
        </p>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">What teams get</h2>
            <ul className="mt-4 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              {bullets.map((item) => (
                <li key={item} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="bg-gradient-to-br from-cyan-600 to-blue-700 text-white">
            <h2 className="text-xl font-semibold">Ready to onboard your HVAC crew?</h2>
            <p className="mt-2 text-sm text-cyan-50">
              Start with manager + worker roles, configure company profile, and begin assigning jobs in minutes.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/register">
                <Button variant="secondary">Create account</Button>
              </Link>
              <Link href="/contact">
                <Button variant="ghost" className="bg-white/10 text-white hover:bg-white/20">
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
