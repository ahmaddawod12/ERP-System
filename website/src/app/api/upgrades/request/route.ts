import { adminDb } from "@/lib/firebase/admin";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";
import { getUserProfileOrThrow } from "@/lib/firebase/server-access";
import { ApiRouteError } from "@/lib/api/errors";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { upgradeRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, upgradeRequestSchema);
    const auth = await resolveRequestAuth(request, body.uid);

    if (body.currentTier && body.currentTier === body.requestedTier) {
      throw new ApiRouteError(
        400,
        "invalid_tier_transition",
        "Requested tier must differ from current tier",
      );
    }

    const profile = await getUserProfileOrThrow(auth.uid);

    const requestRef = adminDb().collection("upgrade_requests").doc();
    const nowIso = new Date().toISOString();
    await requestRef.set({
      uid: auth.uid,
      email: profile.email,
      companyId: profile.companyId,
      role: profile.role,
      currentTier: body.currentTier ?? "Basic",
      requestedTier: body.requestedTier,
      message: body.message,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: "new",
    });

    return apiOk({ requestId: requestRef.id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
