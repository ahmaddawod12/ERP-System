import { redirect } from "next/navigation";

import { requireWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Dashboard | Smart-Job" };

export default async function AppEntryPage() {
  const { viewer } = await requireWebsiteSession("/app");
  const decision = decideWorkspaceEntry(viewer.workspaces);

  if (decision.kind === "onboarding") {
    redirect("/onboarding");
  }
  if (decision.kind === "select") {
    redirect("/app/select-company");
  }
  redirect(`/app/c/${decision.companyId}`);
}
