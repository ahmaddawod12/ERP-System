import { Suspense } from "react";
import { redirect } from "next/navigation";

import RegisterClient from "./page-client";
import { readWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Create Account | Smart-Job" };

export default async function RegisterPage() {
  const session = await readWebsiteSession();
  if (session) {
    const decision = decideWorkspaceEntry(session.viewer.workspaces);
    if (decision.kind === "onboarding") redirect("/onboarding");
    if (decision.kind === "select") redirect("/app/select-company");
    redirect(`/app/c/${decision.companyId}`);
  }

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading…</p></div>}>
      <RegisterClient />
    </Suspense>
  );
}
