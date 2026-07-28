import "server-only";

import {
  WebSessionCreateResultSchema,
  WebSessionCurrentResultSchema,
  WebSessionRevokeResultSchema,
  type WebSessionCreateRequest,
} from "@/lib/auth/web-session-contract";
import { backendRequest } from "./transport";

const WEB_SESSION_PATH = "/api/v1/auth/web-sessions";
const CURRENT_WEB_SESSION_PATH = "/api/v1/auth/web-sessions/current";

function sessionAuthorization(sessionToken: string): string {
  return `SmartJobSession ${sessionToken}`;
}

export async function createWebSession(input: WebSessionCreateRequest) {
  const result = await backendRequest(WEB_SESSION_PATH, WebSessionCreateResultSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return { ...result.data, requestId: result.meta.requestId };
}

export async function readCurrentWebSession(sessionToken: string) {
  const result = await backendRequest(CURRENT_WEB_SESSION_PATH, WebSessionCurrentResultSchema, {
    method: "GET",
    headers: { Authorization: sessionAuthorization(sessionToken) },
  });
  return { ...result.data, requestId: result.meta.requestId };
}

export async function revokeCurrentWebSession(sessionToken: string, csrfToken: string) {
  const result = await backendRequest(CURRENT_WEB_SESSION_PATH, WebSessionRevokeResultSchema, {
    method: "DELETE",
    headers: {
      Authorization: sessionAuthorization(sessionToken),
      "X-SJ-CSRF": csrfToken,
    },
  });
  return { ...result.data, requestId: result.meta.requestId };
}
