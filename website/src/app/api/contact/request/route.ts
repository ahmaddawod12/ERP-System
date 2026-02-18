import { adminDb } from "@/lib/firebase/admin";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { contactRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, contactRequestSchema);
    const nowIso = new Date().toISOString();
    const ref = adminDb().collection("contact_requests").doc();

    await ref.set({
      ...body,
      status: "new",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return apiOk({ requestId: ref.id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

