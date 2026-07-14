import { createCompanyClient } from "@/lib/backend/clients-client";
import { handleClientCreate } from "@/lib/clients/client-mutation-route-core";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await context.params;
  return handleClientCreate(request, companyId, { create: createCompanyClient });
}
