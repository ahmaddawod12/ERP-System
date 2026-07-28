import { handleOpaqueSessionRead } from "@/lib/auth/opaque-session-route-core";
import {
  createWebSession,
  readCurrentWebSession,
  revokeCurrentWebSession,
} from "@/lib/backend/web-session-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleOpaqueSessionRead(request, {
    createSession: createWebSession,
    readSession: readCurrentWebSession,
    revokeSession: revokeCurrentWebSession,
  });
}
