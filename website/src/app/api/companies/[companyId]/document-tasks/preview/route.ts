import { previewCompanyDocument } from "@/lib/backend/documents-client";
import { handleDocumentPreview } from "@/lib/documents/document-mutation-route-core";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await context.params;
  return handleDocumentPreview(request, companyId, { preview: previewCompanyDocument });
}
