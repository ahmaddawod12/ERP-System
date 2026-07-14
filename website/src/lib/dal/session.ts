import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WebSessionToken } from "@smart-job/api-contracts";
import type { WebsiteSessionView } from "@/lib/auth/web-session-contract";
import {
  isOpaqueSessionToken,
  webSessionCookieName,
} from "@/lib/auth/opaque-session";
import { BackendTransportError } from "@/lib/backend/transport-core";
import { readCurrentWebSession } from "@/lib/backend/web-session-client";

export interface WebsiteRequestContext {
  session: WebsiteSessionView;
  /** Server-only credential. Never pass this value into a Client Component. */
  sessionToken: WebSessionToken;
}

/** Per-request cached session resolution for Server Components and server DALs. */
const readWebsiteRequestContext = cache(async (): Promise<WebsiteRequestContext | null> => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(webSessionCookieName())?.value ?? null;
  if (!isOpaqueSessionToken(sessionToken)) {
    return null;
  }

  try {
    const current = await readCurrentWebSession(sessionToken);
    return {
      session: {
        viewer: current.viewer,
        absoluteExpiresAt: current.absoluteExpiresAt,
      },
      sessionToken,
    };
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      return null;
    }
    throw error;
  }
});

export const readWebsiteSession = cache(async (): Promise<WebsiteSessionView | null> => {
  return (await readWebsiteRequestContext())?.session ?? null;
});

function safeReturnPath(returnTo: string): string {
  return returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/app";
}

export async function requireWebsiteRequestContext(
  returnTo = "/app",
): Promise<WebsiteRequestContext> {
  const context = await readWebsiteRequestContext();
  if (!context) {
    redirect(`/login?redirect=${encodeURIComponent(safeReturnPath(returnTo))}`);
  }
  return context;
}

export async function requireWebsiteSession(
  returnTo = "/app",
): Promise<WebsiteSessionView> {
  return (await requireWebsiteRequestContext(returnTo)).session;
}
