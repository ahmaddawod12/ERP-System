import type { Role } from "@/lib/types";
import { adminDb } from "@/lib/firebase/admin";
import { assertCompanyAccess } from "@/lib/firebase/server-access";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { createClientSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const CLIENT_WRITER_ROLES: Role[] = ["Manager", "User", "Basic", "Dev"];

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, createClientSchema);
    const auth = await resolveRequestAuth(request, body.uid);

    await assertCompanyAccess({
      uid: auth.uid,
      companyId: body.companyId,
      allowedRoles: CLIENT_WRITER_ROLES,
    });

    const db = adminDb();
    const companyRef = db.collection("companies").doc(body.companyId);
    const counterRef = companyRef.collection("counters").doc("clients");
    const requestRef = companyRef.collection("client_create_requests").doc(body.requestId);
    const clientsCollection = companyRef.collection("clients");

    const result = await db.runTransaction(async (tx) => {
      const existingRequest = await tx.get(requestRef);
      if (existingRequest.exists) {
        const data = existingRequest.data() as { clientId: string; numericId: number };
        return {
          clientId: data.clientId,
          numericId: data.numericId,
          idempotent: true,
        };
      }

      const counterSnap = await tx.get(counterRef);
      const lastNumber = Number(counterSnap.data()?.lastNumber ?? 0);
      const safeLastNumber = Number.isFinite(lastNumber) && lastNumber >= 0 ? lastNumber : 0;
      const nextNumber = safeLastNumber + 1;
      const clientRef = clientsCollection.doc();
      const nowIso = new Date().toISOString();

      tx.set(
        counterRef,
        {
          lastNumber: nextNumber,
          updatedAt: nowIso,
        },
        { merge: true },
      );

      tx.set(clientRef, {
        numericId: nextNumber,
        name: body.name,
        email: body.email,
        phone: body.phone,
        address: body.address,
        notes: body.notes,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: auth.uid,
      });

      tx.set(requestRef, {
        requestId: body.requestId,
        clientId: clientRef.id,
        numericId: nextNumber,
        createdBy: auth.uid,
        createdAt: nowIso,
      });

      return { clientId: clientRef.id, numericId: nextNumber, idempotent: false };
    });

    return apiOk(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
