import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Documents | Smart-Job" };

export default async function DocumentsRedirectPage() {
  await redirectToTenantRoute("/app/documents", "/documents");
}
