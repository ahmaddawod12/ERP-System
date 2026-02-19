import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { contactRequestSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, contactRequestSchema);
    return await proxyToHttpFunction(request, "contactRequestV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
