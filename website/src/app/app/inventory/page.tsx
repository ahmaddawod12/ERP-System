import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Inventory | Smart-Job" };

export default async function InventoryRedirectPage() {
  await redirectToTenantRoute("/app/inventory", "/inventory");
}
