import type { VerifiedAccessToken } from "@/lib/auth/access-token";
import { parseBearerToken, verifyAccessToken } from "@/lib/auth/access-token";
import { ApiRouteError } from "@/lib/api/errors";

export interface RequestAuthResult {
  uid: string;
  token: VerifiedAccessToken | null;
  source: "token";
  provider: "supabase";
}

export async function resolveRequestAuth(
  request: Request,
): Promise<RequestAuthResult> {
  const token = parseBearerToken(request.headers.get("authorization"));

  if (token) {
    const verifiedToken = await verifyAccessToken(token);
    return {
      uid: verifiedToken.uid,
      token: verifiedToken,
      source: "token",
      provider: verifiedToken.provider,
    };
  }

  throw new ApiRouteError(
    401,
    "unauthorized",
    "Missing Authorization bearer token",
  );
}
