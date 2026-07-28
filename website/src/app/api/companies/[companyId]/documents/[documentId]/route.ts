import { deleteCompanyDocument } from "@/lib/backend/documents-client";
import { handleDocumentDelete } from "@/lib/documents/document-mutation-route-core";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ companyId: string; documentId: string }> },
) {
  const { companyId, documentId } = await context.params;
  return handleDocumentDelete(request, companyId, documentId, { remove: deleteCompanyDocument });
}
