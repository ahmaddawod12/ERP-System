/**
 * Server-side Supabase Auth helpers.
 *
 * These functions run only on the server and use server-scoped environment
 * variables (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY) to talk to Supabase Auth.
 * They centralize signup, password reset, and session creation so that the
 * public anon key is not required by browser code for auth flows.
 */

function getServerSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
  ).trim();
  if (!url || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("Supabase auth is not configured on the server (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required)");
  }
  return { url, publishableKey };
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

export async function serverSignUp(email: string, password: string): Promise<SupabaseAuthResponse> {
  const { url, publishableKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverSendPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { url, publishableKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({
      email,
      redirect_to: redirectTo,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
}

export async function serverResetPassword(accessToken: string, password: string): Promise<SupabaseAuthResponse> {
  const { url, publishableKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverVerifyEmailTokenHash(
  tokenHash: string,
  type: "email" | "recovery",
): Promise<SupabaseAuthResponse> {
  const { url, publishableKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishableKey,
    },
    body: JSON.stringify({ token_hash: tokenHash, type }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverRevokeAuthSession(accessToken: string): Promise<void> {
  const { url, publishableKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 401) {
    const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
    throw new Error(extractErrorMessage(payload));
  }
}
