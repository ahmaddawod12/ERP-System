import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveUidFromRequest } from "@/lib/firebase/request-auth";

interface Body {
  uid?: string;
  companyId?: string;
  type?: string;
  jobId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const uid = await resolveUidFromRequest(request, body.uid);

    if (!uid) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!body.companyId || !body.type) {
      return NextResponse.json({ ok: false, message: "companyId and type are required" }, { status: 400 });
    }

    const certificationsRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("certifications");

    const taskRef = certificationsRef.doc();
    const placeholderUrl = `/downloads/${taskRef.id}.pdf`;

    await taskRef.set({
      id: taskRef.id,
      type: body.type,
      jobId: body.jobId ?? "manual",
      status: "queued",
      createdAt: new Date().toISOString(),
      createdBy: uid,
      downloadUrl: placeholderUrl,
    });

    const cloudRunUrl = process.env.CLOUDRUN_PDF_URL;
    if (cloudRunUrl) {
      try {
        const cloudRunResponse = await fetch(cloudRunUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: taskRef.id,
            uid,
            companyId: body.companyId,
            type: body.type,
            jobId: body.jobId ?? "manual",
          }),
        });

        if (cloudRunResponse.ok) {
          const cloudPayload = (await cloudRunResponse.json()) as { downloadUrl?: string };
          await taskRef.set(
            {
              status: "generated",
              downloadUrl: cloudPayload.downloadUrl ?? placeholderUrl,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        } else {
          await taskRef.set(
            {
              status: "failed",
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        }
      } catch {
        await taskRef.set(
          {
            status: "failed",
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      id: taskRef.id,
      downloadUrl: placeholderUrl,
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

