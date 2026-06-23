/**
 * Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import LoginClient from "./page-client";

export const metadata = { title: "Login | Smart-Job" };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading…</p></div>}>
      <LoginClient />
    </Suspense>
  );
}
