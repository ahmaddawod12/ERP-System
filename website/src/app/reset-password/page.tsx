import { Suspense } from "react";
import { cookies } from "next/headers";
import ResetPasswordClient from "./page-client";
import {
  RECOVERY_CSRF_COOKIE,
  recoveryCookieName,
} from "@/lib/auth/password-recovery";

export const metadata = {
  title: "Reset Password | Smart-Job",
  referrer: "no-referrer" as const,
};

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const recoveryReady = Boolean(
    cookieStore.get(recoveryCookieName())?.value
      && cookieStore.get(RECOVERY_CSRF_COOKIE)?.value,
  );
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>}>
      <ResetPasswordClient recoveryReady={recoveryReady} />
    </Suspense>
  );
}
