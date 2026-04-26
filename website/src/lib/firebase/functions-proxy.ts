import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/api/errors";
import { resolveRequestAuth } from "@/lib/firebase/request-auth";

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const EDGE_FUNCTION_NAME_MAP: Record<string, string> = {
  mutationGatewayV1: "mutation-gateway",
  mutationGatewayMeWest1V1: "mutation-gateway-me-west1",
  readModelV1: "read-model",
  createInviteV1: "invites/create",
  joinCompanyV1: "invites/join",
  requestUpgradeV1: "upgrades/request",
  listUpgradeRequestsV1: "upgrades/list",
  moderateUpgradeRequestV1: "upgrades/moderate",
  contactRequestV1: "contact/request",
};

function getEdgeFunctionsBaseUrl() {
  const explicitBase = process.env.BACKEND_EDGE_FUNCTIONS_BASE_URL;
  if (explicitBase) {
    const parsed = new URL(explicitBase);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new ApiRouteError(
        500,
        "edge_base_url_invalid",
        "Supabase Edge base URL must be HTTPS in production",
      );
    }
    if (!isLocal && parsed.protocol !== "https:") {
      throw new ApiRouteError(500, "edge_base_url_invalid", "Supabase Edge base URL must use HTTPS");
    }
    return trimTrailingSlash(parsed.toString());
  }

  const supabaseUrl = trimTrailingSlash(
    String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
  );
  if (!supabaseUrl) {
    throw new ApiRouteError(
      500,
      "supabase_url_missing",
      "Supabase URL is not configured for edge proxy",
    );
  }
  return `${supabaseUrl}/functions/v1`;
}

function getEdgeFunctionPath(functionName: string): string {
  return EDGE_FUNCTION_NAME_MAP[functionName] || functionName;
}

function getEdgeFunctionUrl(functionName: string) {
  return `${getEdgeFunctionsBaseUrl()}/${getEdgeFunctionPath(functionName)}`;
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
  options?: { requireAuth?: boolean; region?: string },
) {
  void options?.region;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(getEdgeFunctionUrl(functionName), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new ApiRouteError(502, "edge_unreachable", "Could not reach Supabase Edge endpoint");
  } finally {
    clearTimeout(timeout);
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
