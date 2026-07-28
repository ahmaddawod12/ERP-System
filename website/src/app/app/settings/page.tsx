import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Settings | Smart-Job" };

export default async function SettingsRedirectPage() {
  await redirectToTenantRoute("/app/settings", "/settings");
}
