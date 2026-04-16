import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { upgradeModerationSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, upgradeModerationSchema);
    return await proxyToHttpFunction(request, "moderateUpgradeRequestV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
