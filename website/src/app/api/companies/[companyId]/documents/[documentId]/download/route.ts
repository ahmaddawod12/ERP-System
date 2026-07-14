import { getCompanyDocumentDownload } from "@/lib/backend/documents-client";
import { handleDocumentDownload } from "@/lib/documents/document-download-route-core";

export const runtime = "nodejs";

interface DocumentDownloadRouteContext {
  readonly params: Promise<{ companyId: string; documentId: string }>;
}

export async function GET(request: Request, context: DocumentDownloadRouteContext) {
  const { companyId, documentId } = await context.params;
  return handleDocumentDownload(request, companyId, documentId, {
    read: getCompanyDocumentDownload,
  });
}
