import { adjustCompanyInventoryPart } from "@/lib/backend/inventory-client";
import { handleInventoryAdjustment } from "@/lib/inventory/inventory-mutation-route-core";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string; partId: string }> },
) {
  const { companyId, partId } = await context.params;
  return handleInventoryAdjustment(request, companyId, partId, {
    adjust: adjustCompanyInventoryPart,
  });
}
