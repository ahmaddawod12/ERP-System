import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { documentGenerateSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, documentGenerateSchema);
    return await proxyToHttpFunction(request, "generateDocumentV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
