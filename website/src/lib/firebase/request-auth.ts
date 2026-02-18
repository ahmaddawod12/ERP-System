import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase/admin";
import { ApiRouteError } from "@/lib/api/errors";

const BEARER_PREFIX = "Bearer ";

function isDevUidFallbackEnabled() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  );
}

function parseBearerToken(header: string | null) {
  if (!header) return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export interface RequestAuthResult {
  uid: string;
  token: DecodedIdToken | null;
  source: "token" | "dev_fallback";
}

export async function resolveRequestAuth(
  request: Request,
  fallbackUid?: string,
): Promise<RequestAuthResult> {
  const token = parseBearerToken(request.headers.get("authorization"));

  if (token) {
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      return {
        uid: decoded.uid,
        token: decoded,
        source: "token",
      };
    } catch {
      throw new ApiRouteError(401, "invalid_token", "Invalid or expired auth token");
    }
  }

  if (fallbackUid && isDevUidFallbackEnabled()) {
    return {
      uid: fallbackUid,
      token: null,
      source: "dev_fallback",
    };
  }

  throw new ApiRouteError(
    401,
    "unauthorized",
    "Missing Authorization bearer token",
  );
}
