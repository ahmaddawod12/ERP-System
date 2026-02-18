import { adminAuth } from "@/lib/firebase/admin";

export async function resolveUidFromRequest(
  request: Request,
  fallbackUid?: string,
) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const idToken = authHeader.replace("Bearer ", "");
    try {
      const decoded = await adminAuth().verifyIdToken(idToken);
      return decoded.uid;
    } catch {
      // Fallback remains allowed for local development paths.
    }
  }
  return fallbackUid ?? null;
}

