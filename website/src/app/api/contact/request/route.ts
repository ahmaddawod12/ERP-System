import { parseRequestBody } from "@/lib/api/request";
import { ApiRouteError } from "@/lib/api/errors";
import { handleRouteError } from "@/lib/api/response";
import { proxyToHttpFunction } from "@/lib/firebase/functions-proxy";
import { contactRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, contactRequestSchema);
    if (body.website) {
      throw new ApiRouteError(400, "spam_rejected", "Spam submission rejected");
    }
    if (body.challenge !== "7") {
      throw new ApiRouteError(400, "invalid_challenge", "Challenge response is invalid");
    }
    return await proxyToHttpFunction(request, "contactRequestV1", {
      name: body.name,
      email: body.email,
      subject: body.company,
      message: body.message,
      fromApp: false,
    }, {
      requireAuth: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
