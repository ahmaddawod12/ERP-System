import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";
import { contactRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, contactRequestSchema);
    return await proxyToHttpFunction(request, "contactRequestV1", body, {
      requireAuth: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
