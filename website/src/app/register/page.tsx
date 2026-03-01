/**
 * Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import RegisterClient from "./page-client";

export const metadata = { title: "Create Account | Smart-Job" };

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading…</p></div>}>
      <RegisterClient />
    </Suspense>
  );
}
