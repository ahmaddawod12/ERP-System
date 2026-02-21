import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { documentGenerateSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

/**
 * @deprecated Use Pub/Sub document tasks (publishPreviewTask / publishGenerateTask) instead.
 * This route proxies to the legacy generateDocumentV1 Cloud Function which is also deprecated.
 * Retained for backward compatibility — do not add new callers.
 */
export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, documentGenerateSchema);
    return await proxyToHttpFunction(request, "generateDocumentV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
