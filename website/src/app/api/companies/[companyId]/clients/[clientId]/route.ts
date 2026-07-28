import {
  deleteOrArchiveCompanyClient,
  updateCompanyClient,
} from "@/lib/backend/clients-client";
import {
  handleClientDelete,
  handleClientUpdate,
} from "@/lib/clients/client-mutation-route-core";

export const runtime = "nodejs";

interface ClientRouteContext {
  readonly params: Promise<{ companyId: string; clientId: string }>;
}

export async function PATCH(request: Request, context: ClientRouteContext) {
  const { companyId, clientId } = await context.params;
  return handleClientUpdate(request, companyId, clientId, { update: updateCompanyClient });
}

export async function DELETE(request: Request, context: ClientRouteContext) {
  const { companyId, clientId } = await context.params;
  return handleClientDelete(request, companyId, clientId, {
    remove: deleteOrArchiveCompanyClient,
  });
}
