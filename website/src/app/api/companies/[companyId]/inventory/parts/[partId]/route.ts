import {
  archiveCompanyInventoryPart,
  updateCompanyInventoryPart,
} from "@/lib/backend/inventory-client";
import {
  handleInventoryPartArchive,
  handleInventoryPartUpdate,
} from "@/lib/inventory/inventory-mutation-route-core";

export const runtime = "nodejs";

interface InventoryPartRouteContext {
  readonly params: Promise<{ companyId: string; partId: string }>;
}

export async function PATCH(request: Request, context: InventoryPartRouteContext) {
  const { companyId, partId } = await context.params;
  return handleInventoryPartUpdate(request, companyId, partId, {
    update: updateCompanyInventoryPart,
  });
}

export async function DELETE(request: Request, context: InventoryPartRouteContext) {
  const { companyId, partId } = await context.params;
  return handleInventoryPartArchive(request, companyId, partId, {
    archive: archiveCompanyInventoryPart,
  });
}
