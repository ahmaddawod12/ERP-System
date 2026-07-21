/**
 * Server-side Supabase Auth helpers.
 *
 * These functions run only on the server and use server-scoped environment
 * variables (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY) to talk to Supabase Auth.
 * They centralize signup, password reset, and session creation so that the
 * public anon key is not required by browser code for auth flows.
 */

const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_AUTH_TIMEOUT_MS = 8_000;

function getServerSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
  ).trim();
  if (!url || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("Supabase auth is not configured on the server (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required)");
  }
  const configuredTimeout = Number(process.env.SUPABASE_AUTH_TIMEOUT_MS || DEFAULT_AUTH_TIMEOUT_MS);
  const timeoutMs = Number.isSafeInteger(configuredTimeout)
    ? Math.min(12_000, Math.max(1_000, configuredTimeout))
    : DEFAULT_AUTH_TIMEOUT_MS;
  return { url, publishableKey, timeoutMs };
}

export type SupabaseAuthResponse = {
  user?: {
    id?: string;
    email?: string;
    [key: string]: unknown;
  } | null;
  session?: {
    access_token?: string;
    [key: string]: unknown;
  } | null;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  error?: string;
  error_description?: string;
  msg?: string;
};

function extractErrorMessage(payload: SupabaseAuthResponse): string {
  return String(
    payload.error_description || payload.msg || payload.error || "Auth request failed",
  );
}

async function readBoundedAuthResponse(response: Response): Promise<SupabaseAuthResponse> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_AUTH_RESPONSE_BYTES) {
    throw new Error("Auth response exceeded the safe size limit");
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_AUTH_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Auth response exceeded the safe size limit");
    }
    chunks.push(part.value);
  }
  if (total === 0) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as SupabaseAuthResponse;
  } catch {
    return {};
  }
}

async function serverAuthFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ readonly response: Response; readonly payload: SupabaseAuthResponse }> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, payload: await readBoundedAuthResponse(response) };
}

export async function serverSignUp(email: string, password: string): Promise<SupabaseAuthResponse> {
  const { url, publishableKey, timeoutMs } = getServerSupabaseConfig();
  const { response, payload } = await serverAuthFetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({ email, password }),
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverSendPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { url, publishableKey, timeoutMs } = getServerSupabaseConfig();
  const { response, payload } = await serverAuthFetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({
      email,
      redirect_to: redirectTo,
    }),
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
}

export async function serverResetPassword(accessToken: string, password: string): Promise<SupabaseAuthResponse> {
  const { url, publishableKey, timeoutMs } = getServerSupabaseConfig();
  const { response, payload } = await serverAuthFetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password }),
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverVerifyEmailTokenHash(
  tokenHash: string,
  type: "email" | "recovery",
): Promise<SupabaseAuthResponse> {
  const { url, publishableKey, timeoutMs } = getServerSupabaseConfig();
  const { response, payload } = await serverAuthFetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({ token_hash: tokenHash, type }),
    cache: "no-store",
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverRevokeAuthSession(accessToken: string): Promise<void> {
  const { url, publishableKey, timeoutMs } = getServerSupabaseConfig();
  const { response, payload } = await serverAuthFetch(`${url}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  }, timeoutMs);
  if (!response.ok && response.status !== 401) {
    throw new Error(extractErrorMessage(payload));
  }
}
