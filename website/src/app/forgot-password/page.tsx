/**
 * Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import ForgotPasswordClient from "./page-client";

export const metadata = { title: "Forgot Password | Smart-Job" };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading…</p></div>}>
      <ForgotPasswordClient />
    </Suspense>
  );
}
