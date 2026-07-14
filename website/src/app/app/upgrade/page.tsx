import { redirect } from "next/navigation";

import { requireWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Upgrade | Smart-Job" };

export default async function UpgradeRedirectPage() {
  const session = await requireWebsiteSession("/app/upgrade");
  const decision = decideWorkspaceEntry(session.viewer.workspaces);
  if (decision.kind === "onboarding") redirect("/onboarding");
  if (decision.kind === "select") redirect("/app/select-company");
  redirect(`/app/c/${decision.companyId}/upgrade`);
}
