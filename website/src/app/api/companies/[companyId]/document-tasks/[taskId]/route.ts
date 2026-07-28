import { readCompanyDocumentTask } from "@/lib/backend/documents-client";
import { handleDocumentTaskRead } from "@/lib/documents/document-task-route-core";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string; taskId: string }> },
) {
  const { companyId, taskId } = await context.params;
  return handleDocumentTaskRead(request, companyId, taskId, { read: readCompanyDocumentTask });
}
