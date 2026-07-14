import { createCompanyInventoryPart } from "@/lib/backend/inventory-client";
import { handleInventoryPartCreate } from "@/lib/inventory/inventory-mutation-route-core";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await context.params;
  return handleInventoryPartCreate(request, companyId, {
    create: createCompanyInventoryPart,
  });
}
