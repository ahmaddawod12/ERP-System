import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveUidFromRequest } from "@/lib/firebase/request-auth";

interface Body {
  uid?: string;
  email?: string;
  role?: "Worker" | "User" | "Basic";
  name?: string;
  phoneNumber?: string;
  companyId?: string;
  inviteCode?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const uid = await resolveUidFromRequest(request, body.uid);

    if (!uid) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!body.companyId || !body.inviteCode || !body.email) {
      return NextResponse.json(
        { ok: false, message: "companyId, inviteCode, and email are required" },
        { status: 400 },
      );
    }

    const invitesRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("invites");

    const inviteSnap = await invitesRef.where("code", "==", body.inviteCode).limit(1).get();
    if (inviteSnap.empty) {
      return NextResponse.json({ ok: false, message: "Invalid invite code" }, { status: 400 });
    }

    const inviteDoc = inviteSnap.docs[0];
    const inviteData = inviteDoc.data();
    if (inviteData.usedBy) {
      return NextResponse.json({ ok: false, message: "Invite code already used" }, { status: 400 });
    }

    await inviteDoc.ref.set(
      {
        usedBy: uid,
        usedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    const workerRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("workers")
      .doc(uid);

    await workerRef.set(
      {
        workerId: uid,
        email: body.email,
        role: body.role ?? "Worker",
        name: body.name ?? "",
        phoneNumber: body.phoneNumber ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return NextResponse.json({
      ok: true,
      companyId: body.companyId,
    });
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

