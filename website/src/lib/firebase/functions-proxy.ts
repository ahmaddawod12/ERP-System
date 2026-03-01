import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/api/errors";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getFunctionsRegion() {
  return process.env.FIREBASE_FUNCTIONS_REGION || "us-central1";
}

function getProjectId() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (!projectId) {
    throw new ApiRouteError(
      500,
      "functions_project_id_missing",
      "Firebase project ID is not configured for function proxy",
    );
  }
  return projectId;
}

function getFunctionsBaseUrl() {
  const explicitBase = process.env.FIREBASE_FUNCTIONS_BASE_URL;
  if (explicitBase) {
    return trimTrailingSlash(explicitBase);
  }

  const region = getFunctionsRegion();
  const projectId = getProjectId();
  const emulatorEnabled =
    process.env.NODE_ENV !== "production" &&
    (
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" ||
      Boolean(process.env.FIRESTORE_EMULATOR_HOST)
    );

  if (emulatorEnabled) {
    const emulatorOrigin = trimTrailingSlash(process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN || "http://127.0.0.1:5001");
    return `${emulatorOrigin}/${projectId}/${region}`;
  }

  return `https://${region}-${projectId}.cloudfunctions.net`;
}

function getFunctionUrl(functionName: string) {
  return `${getFunctionsBaseUrl()}/${functionName}`;
}

function assertFunctionPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new ApiRouteError(
      502,
      "function_invalid_response",
      "Function returned an invalid payload",
    );
  }
}

export async function proxyToHttpFunction(
  request: Request,
  functionName: string,
  body: unknown,
  options?: { requireAuth?: boolean },
) {
  const requireAuth = options?.requireAuth !== false;
  if (requireAuth) {
    // P1-3: Verify auth server-side before proxying (defense-in-depth)
    await resolveRequestAuth(request);
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.set("Authorization", authorization);
  }

  let response: Response;
  try {
    response = await fetch(getFunctionUrl(functionName), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiRouteError(502, "function_unreachable", "Could not reach Cloud Function endpoint");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRouteError(502, "function_invalid_json", "Function did not return valid JSON");
  }

  assertFunctionPayload(payload);
  return NextResponse.json(payload, { status: response.status });
}
