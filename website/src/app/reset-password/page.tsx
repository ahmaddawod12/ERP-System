import { Suspense } from "react";
import ResetPasswordClient from "./page-client";

export const metadata = { title: "Reset Password | Smart-Job" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
