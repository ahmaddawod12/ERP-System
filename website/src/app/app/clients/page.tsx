import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Clients | Smart-Job" };

export default async function ClientsRedirectPage() {
  await redirectToTenantRoute("/app/clients", "/clients");
}
