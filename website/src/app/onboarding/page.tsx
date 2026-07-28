import { redirect } from "next/navigation";

import OnboardingClient from "./page-client";
import { requireWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Onboarding | Smart-Job" };

export default async function OnboardingPage() {
  const { viewer } = await requireWebsiteSession("/onboarding");
  const decision = decideWorkspaceEntry(viewer.workspaces);

  if (decision.kind === "select") {
    redirect("/app/select-company");
  }
  if (decision.kind === "workspace") {
    redirect(`/app/c/${decision.companyId}`);
  }

  return <OnboardingClient viewer={viewer} />;
}
