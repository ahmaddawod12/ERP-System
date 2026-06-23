/**
 * Server-side Supabase Auth helpers.
 *
 * These functions run only on the server and use the non-public environment
 * variables (SUPABASE_URL / SUPABASE_ANON_KEY) to talk to Supabase Auth.
 * They centralize signup, password reset, and session creation so that the
 * public anon key is not required by browser code for auth flows.
 */

function getServerSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) {
    throw new Error("Supabase auth is not configured on the server (SUPABASE_URL and SUPABASE_ANON_KEY are required)");
  }
  return { url, anonKey };
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
  const { url, anonKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
  return payload;
}

export async function serverSendPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const { url, anonKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email,
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }
}

export async function serverResetPassword(accessToken: string, password: string): Promise<SupabaseAuthResponse> {
  const { url, anonKey } = getServerSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
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
