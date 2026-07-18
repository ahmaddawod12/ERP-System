import { redirectToTenantRoute } from "@/lib/dal/legacy-redirect";

export const metadata = { title: "Inventory Picks | Smart-Job" };

export default async function InventoryPicksRedirectPage() {
  await redirectToTenantRoute("/app/inventory-picks", "/inventory");
}
