import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveUidFromRequest } from "@/lib/firebase/request-auth";
import { generateInviteCode } from "@/lib/utils";

interface Body {
  companyId?: string;
  uid?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const uid = await resolveUidFromRequest(request, body.uid);

    if (!uid) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!body.companyId) {
      return NextResponse.json({ ok: false, message: "companyId is required" }, { status: 400 });
    }

    const workerRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("workers")
      .doc(uid);

    const workerSnap = await workerRef.get();
    const role = workerSnap.data()?.role as string | undefined;
    if (!workerSnap.exists || (role !== "Manager" && role !== "Dev")) {
      return NextResponse.json({ ok: false, message: "Insufficient permissions" }, { status: 403 });
    }

    const inviteCode = generateInviteCode();
    const inviteRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("invites")
      .doc();

    await inviteRef.set({
      inviteId: inviteRef.id,
      code: inviteCode,
      createdBy: uid,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, inviteId: inviteRef.id, inviteCode });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unexpected error",
      },
      { status: 500 },
    );
  }
}

