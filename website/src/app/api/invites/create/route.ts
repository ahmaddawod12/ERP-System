import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { createInviteSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, createInviteSchema);
    return await proxyToHttpFunction(request, "createInviteV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
