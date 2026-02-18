import type { Role } from "@/lib/types";
import { adminDb } from "@/lib/firebase/admin";
import { assertCompanyAccess } from "@/lib/firebase/server-access";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";
import { parseRequestBody } from "@/lib/api/request";
import { apiOk, handleRouteError } from "@/lib/api/response";
import { documentGenerateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const ALLOWED_ROLES: Role[] = ["Manager", "Worker", "User", "Basic", "Dev"];

export async function POST(request: Request) {
  try {
    const body = await parseRequestBody(request, documentGenerateSchema);
    const auth = await resolveRequestAuth(request, body.uid);

    await assertCompanyAccess({
      uid: auth.uid,
      companyId: body.companyId,
      allowedRoles: ALLOWED_ROLES,
      allowSoloScope: true,
    });

    const certificationsRef = adminDb()
      .collection("companies")
      .doc(body.companyId)
      .collection("certifications");

    const taskRef = certificationsRef.doc();
    const placeholderUrl = `/downloads/${taskRef.id}.pdf`;
    const nowIso = new Date().toISOString();

    await taskRef.set({
      id: taskRef.id,
      type: body.type,
      jobId: body.jobId ?? "manual",
      status: "queued",
      createdAt: nowIso,
      createdBy: auth.uid,
      downloadUrl: placeholderUrl,
    });

    const cloudRunUrl = process.env.CLOUDRUN_PDF_URL;
    let status: "queued" | "generated" | "failed" = "queued";
    let resolvedDownloadUrl = placeholderUrl;

    if (cloudRunUrl) {
      try {
        const cloudRunResponse = await fetch(cloudRunUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: taskRef.id,
            uid: auth.uid,
            companyId: body.companyId,
            type: body.type,
            jobId: body.jobId ?? "manual",
          }),
        });

        if (cloudRunResponse.ok) {
          const cloudPayload = (await cloudRunResponse.json()) as { downloadUrl?: string };
          resolvedDownloadUrl = cloudPayload.downloadUrl ?? placeholderUrl;
          status = "generated";
          await taskRef.set(
            {
              status,
              downloadUrl: resolvedDownloadUrl,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        } else {
          status = "failed";
          await taskRef.set(
            {
              status,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        }
      } catch {
        status = "failed";
        await taskRef.set(
          {
            status,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      }
    }

    return apiOk({
      id: taskRef.id,
      downloadUrl: resolvedDownloadUrl,
      status,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
