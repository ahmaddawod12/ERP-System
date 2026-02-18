import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveUidFromRequest } from "@/lib/firebase/request-auth";

interface Body {
  uid?: string;
  companyId?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const uid = await resolveUidFromRequest(request, body.uid);

    if (!uid) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!body.companyId || !body.name) {
      return NextResponse.json({ ok: false, message: "companyId and name are required" }, { status: 400 });
    }

    const workerRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("workers")
      .doc(uid);
    const workerSnap = await workerRef.get();
    const role = workerSnap.data()?.role as string | undefined;
    if (!workerSnap.exists || role === "Worker") {
      return NextResponse.json({ ok: false, message: "Insufficient permissions" }, { status: 403 });
    }

    const counterRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("counters")
      .doc("clients");

    const clientsCollection = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("clients");

    const result = await adminDb().runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const lastNumber = counterSnap.exists ? (counterSnap.data()?.lastNumber as number) : 0;
      const nextNumber = lastNumber + 1;
      tx.set(counterRef, { lastNumber: nextNumber }, { merge: true });

      const clientRef = clientsCollection.doc();
      tx.set(clientRef, {
        numericId: nextNumber,
        name: body.name,
        email: body.email ?? "",
        phone: body.phone ?? "",
        address: body.address ?? "",
        notes: body.notes ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: uid,
      });

      return { clientId: clientRef.id, numericId: nextNumber };
    });

    return NextResponse.json({ ok: true, ...result });
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

