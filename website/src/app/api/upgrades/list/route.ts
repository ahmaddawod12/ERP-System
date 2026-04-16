import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { upgradeListSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, upgradeListSchema);
    return await proxyToHttpFunction(request, "listUpgradeRequestsV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
