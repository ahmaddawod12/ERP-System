import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { createClientSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateLimitResponse = checkRateLimit(`clients:${ip}`, { max: 10, windowMs: 60_000 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await parseRequestBody(request, createClientSchema);
    return await proxyToHttpFunction(request, "addClientV1", body);
  } catch (error) {
    return handleRouteError(error);
  }
}
