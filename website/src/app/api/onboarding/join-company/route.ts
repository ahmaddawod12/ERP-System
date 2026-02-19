import { adminDb } from "@/lib/firebase/admin";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";
import { ApiRouteError } from "@/lib/api/errors";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { joinCompanySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, joinCompanySchema);
    const auth = await resolveRequestAuth(request, body.uid);

    if (auth.token?.email && auth.token.email.toLowerCase() !== body.email.toLowerCase()) {
      throw new ApiRouteError(403, "email_mismatch", "Email does not match authenticated user");
    }

    const invitesRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("invites");

    const inviteSnap = await invitesRef.where("code", "==", body.inviteCode).limit(1).get();
    if (inviteSnap.empty) {
      throw new ApiRouteError(400, "invalid_invite", "Invalid invite code");
    }

    const inviteDoc = inviteSnap.docs[0];
    const workerRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("workers")
      .doc(auth.uid);
    const profileRef = adminDb().collection("users").doc(auth.uid).collection("data").doc("profile");

    const result = await adminDb().runTransaction(async (tx) => {
      const [inviteDocSnap, workerSnap, profileSnap] = await Promise.all([
        tx.get(inviteDoc.ref),
        tx.get(workerRef),
        tx.get(profileRef),
      ]);

      if (!inviteDocSnap.exists) {
        throw new ApiRouteError(400, "invalid_invite", "Invite code no longer exists");
      }

      const inviteData = inviteDocSnap.data() as {
        usedBy?: string | null;
        status?: string;
        targetRole?: "Worker" | "User" | "Basic";
        expiresAt?: string;
      };

      const now = Date.now();
      if (inviteData.expiresAt && Date.parse(inviteData.expiresAt) < now) {
        throw new ApiRouteError(400, "invite_expired", "Invite code has expired");
      }

      if (inviteData.status && inviteData.status !== "active" && inviteData.usedBy !== auth.uid) {
        throw new ApiRouteError(400, "invite_unavailable", "Invite code is not active");
      }

      if (inviteData.usedBy && inviteData.usedBy !== auth.uid) {
        throw new ApiRouteError(400, "invite_used", "Invite code was already used");
      }

      const resolvedRole = workerSnap.exists
        ? ((workerSnap.data()?.role as "Worker" | "User" | "Basic") ?? "Worker")
        : inviteData.targetRole ?? body.role ?? "Worker";

      const nowIso = new Date(now).toISOString();

      tx.set(
        inviteDoc.ref,
        {
          usedBy: auth.uid,
          usedAt: nowIso,
          status: "used",
        },
        { merge: true },
      );

      tx.set(
        workerRef,
        {
          workerId: auth.uid,
          email: body.email,
          role: resolvedRole,
          name: body.name,
          phoneNumber: body.phoneNumber,
          createdAt: workerSnap.exists
            ? (workerSnap.data()?.createdAt as string | undefined) ?? nowIso
            : nowIso,
          updatedAt: nowIso,
        },
        { merge: true },
      );

      tx.set(
        profileRef,
        {
          uid: auth.uid,
          email: body.email,
          role: resolvedRole,
          companyId: body.companyId,
          accountType: "business",
          name: body.name,
          phoneNumber: body.phoneNumber,
          createdAt: profileSnap.exists
            ? (profileSnap.data()?.createdAt as string | undefined) ?? nowIso
            : nowIso,
          updatedAt: nowIso,
        },
        { merge: true },
      );

      return {
        companyId: body.companyId,
        role: resolvedRole,
      };
    });

    return apiOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
