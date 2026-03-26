import { parseRequestBody } from "@/lib/api/request";
import { handleRouteError } from "@/lib/api/response";
import { contactRequestSchema } from "@/lib/validation/schemas";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Rate limit by IP — 5 requests per minute for unauthenticated endpoint
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateLimitResponse = checkRateLimit(`contact:${ip}`, { max: 5, windowMs: 60_000 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await parseRequestBody(request, contactRequestSchema);
    return await proxyToHttpFunction(request, "contactRequestV1", body, { requireAuth: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
