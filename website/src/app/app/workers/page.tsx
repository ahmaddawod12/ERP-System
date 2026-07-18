import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Workers | Smart-Job" };

export default async function WorkersRedirectPage() {
  await redirectToTenantRoute("/app/workers", "/workers");
}
