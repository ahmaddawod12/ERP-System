import { handleOpaqueSessionLogin } from "@/lib/auth/opaque-session-route-core";
import {
  createWebSession,
  readCurrentWebSession,
  revokeCurrentWebSession,
} from "@/lib/backend/web-session-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOpaqueSessionLogin(request, {
    createSession: createWebSession,
    readSession: readCurrentWebSession,
    revokeSession: revokeCurrentWebSession,
  });
}
