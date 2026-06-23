/**
 * Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import OnboardingClient from "./page-client";

export const metadata = { title: "Onboarding | Smart-Job" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading…</p></div>}>
      <OnboardingClient />
    </Suspense>
  );
}
