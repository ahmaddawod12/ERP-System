import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveUidFromRequest } from "@/lib/firebase/request-auth";

interface Body {
  uid?: string;
  currentTier?: string;
  requestedTier?: string;
  message?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const uid = await resolveUidFromRequest(request, body.uid);
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!body.requestedTier || !body.message) {
      return NextResponse.json({ ok: false, message: "requestedTier and message are required" }, { status: 400 });
    }

    const requestRef = adminDb().collection("upgrade_requests").doc();
    await requestRef.set({
      uid,
      currentTier: body.currentTier ?? "Basic",
      requestedTier: body.requestedTier,
      message: body.message,
      createdAt: new Date().toISOString(),
      status: "new",
    });

    return NextResponse.json({ ok: true, requestId: requestRef.id });
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

