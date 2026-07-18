import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Jobs | Smart-Job" };

export default async function JobsRedirectPage() {
  await redirectToTenantRoute("/app/jobs", "/jobs");
}
