import type { Role } from "@/lib/types";
import { adminDb } from "@/lib/firebase/admin";
import { assertCompanyAccess } from "@/lib/firebase/server-access";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { createInviteSchema } from "@/lib/validation/schemas";
import { generateInviteCode } from "@/lib/utils";

export const runtime = "nodejs";

const INVITE_CREATORS: Role[] = ["Manager", "Dev"];
const INVITE_EXPIRY_DAYS = 7;

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, createInviteSchema);
    const auth = await resolveRequestAuth(request, body.uid);

    await assertCompanyAccess({
      uid: auth.uid,
      companyId: body.companyId,
      allowedRoles: INVITE_CREATORS,
    });

    const inviteCode = generateInviteCode();
    const inviteRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("invites")
      .doc();

    const now = Date.now();
    await inviteRef.set({
      inviteId: inviteRef.id,
      code: inviteCode,
      companyId: body.companyId,
      targetRole: body.targetRole,
      status: "active",
      createdBy: auth.uid,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      usedBy: null,
      usedAt: null,
    });

    return apiOk({
      inviteId: inviteRef.id,
      inviteCode,
      expiresAt: new Date(now + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      targetRole: body.targetRole,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
