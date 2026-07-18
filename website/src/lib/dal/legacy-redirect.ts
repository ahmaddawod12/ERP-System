import { redirect } from "next/navigation";

import { requireWebsiteSession } from "@/lib/dal/session";
import { decideWorkspaceEntry } from "@/lib/dal/workspace-routing";

export async function redirectToTenantRoute(
  path: string,
  subPath: string = "",
): Promise<never> {
  const { viewer } = await requireWebsiteSession(path);
  const decision = decideWorkspaceEntry(viewer.workspaces);

  if (decision.kind === "onboarding") {
    redirect("/onboarding");
  }
  if (decision.kind === "select") {
    redirect("/app/select-company");
  }
  redirect(`/app/c/${decision.companyId}${subPath}`);
}
