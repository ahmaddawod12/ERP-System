import { generateCompanyDocument } from "@/lib/backend/documents-client";
import { handleDocumentGenerate } from "@/lib/documents/document-mutation-route-core";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await context.params;
  return handleDocumentGenerate(request, companyId, { generate: generateCompanyDocument });
}
