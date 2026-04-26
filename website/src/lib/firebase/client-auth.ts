"use client";

export interface ClientAuthUser {
  uid: string;
  email: string | null;
}

type AuthChangeCallback = (user: ClientAuthUser | null) => void;

const SUPABASE_ACCESS_TOKEN_KEY = "sj_supabase_access_token";
const SUPABASE_EXPIRES_AT_KEY = "sj_supabase_expires_at";
const SUPABASE_USER_KEY = "sj_supabase_user";
let inMemoryRefreshToken = "";

const supabaseListeners = new Set<AuthChangeCallback>();

function readSupabaseConfig() {
  const baseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!baseUrl || !anonKey) {
    throw new Error("Supabase auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return { baseUrl, anonKey };
}

function readSupabaseUser(): ClientAuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUPABASE_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; email?: unknown };
    const uid = String(parsed?.id ?? "").trim();
    if (!uid) return null;
    return {
      uid,
      email: typeof parsed.email === "string" ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

function writeSupabaseSession(payload: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string | null };
}) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUPABASE_ACCESS_TOKEN_KEY, payload.accessToken);
  inMemoryRefreshToken = payload.refreshToken;
  window.localStorage.setItem(SUPABASE_EXPIRES_AT_KEY, String(payload.expiresAt));
  window.localStorage.setItem(SUPABASE_USER_KEY, JSON.stringify(payload.user));
}

function clearSupabaseSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SUPABASE_ACCESS_TOKEN_KEY);
  inMemoryRefreshToken = "";
  window.localStorage.removeItem(SUPABASE_EXPIRES_AT_KEY);
  window.localStorage.removeItem(SUPABASE_USER_KEY);
}

function notifySupabaseListeners() {
  const user = readSupabaseUser();
  for (const listener of supabaseListeners) {
    listener(user);
  }
}

async function refreshSupabaseAccessTokenIfNeeded() {
  if (typeof window === "undefined") return null;

  const accessToken = window.localStorage.getItem(SUPABASE_ACCESS_TOKEN_KEY) || "";
  const refreshToken = inMemoryRefreshToken;
  const expiresAt = Number(window.localStorage.getItem(SUPABASE_EXPIRES_AT_KEY) || 0);

  if (!accessToken) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(expiresAt) && expiresAt > now + 30) {
    return accessToken;
  }

  if (!refreshToken) {
    clearSupabaseSession();
    notifySupabaseListeners();
    return null;
  }

  const { baseUrl, anonKey } = readSupabaseConfig();
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    clearSupabaseSession();
    notifySupabaseListeners();
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    user?: { id?: unknown; email?: unknown };
  };

  const nextAccessToken = String(payload.access_token || "").trim();
  const nextRefreshToken = String(payload.refresh_token || "").trim();
  const nextUserId = String(payload.user?.id || "").trim();
  const nextExpiresAt = Number(payload.expires_at || 0);
  if (!nextAccessToken || !nextRefreshToken || !nextUserId || !Number.isFinite(nextExpiresAt)) {
    clearSupabaseSession();
    notifySupabaseListeners();
    return null;
  }

  writeSupabaseSession({
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
    expiresAt: nextExpiresAt,
    user: {
      id: nextUserId,
      email: typeof payload.user?.email === "string" ? payload.user.email : null,
    },
  });
  notifySupabaseListeners();
  return nextAccessToken;
}

export async function signInWithConfiguredProvider(email: string, password: string): Promise<ClientAuthUser> {
  const { baseUrl, anonKey } = readSupabaseConfig();
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    user?: { id?: unknown; email?: unknown };
    error_description?: unknown;
    msg?: unknown;
  };

  if (!response.ok) {
    const errorMessage = String(payload.error_description || payload.msg || "Invalid credentials");
    throw new Error(errorMessage);
  }

  const accessToken = String(payload.access_token || "").trim();
  const refreshToken = String(payload.refresh_token || "").trim();
  const uid = String(payload.user?.id || "").trim();
  const expiresAt = Number(payload.expires_at || 0);
  if (!accessToken || !refreshToken || !uid || !Number.isFinite(expiresAt)) {
    throw new Error("Supabase returned an invalid auth payload");
  }

  const user: ClientAuthUser = {
    uid,
    email: typeof payload.user?.email === "string" ? payload.user.email : null,
  };

  writeSupabaseSession({
    accessToken,
    refreshToken,
    expiresAt,
    user: {
      id: user.uid,
      email: user.email,
    },
  });
  notifySupabaseListeners();
  return user;
}

export async function signOutConfiguredProvider() {
  try {
    const token = window.localStorage.getItem(SUPABASE_ACCESS_TOKEN_KEY) || "";
    if (token) {
      const { baseUrl, anonKey } = readSupabaseConfig();
      await fetch(`${baseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
      }).catch(() => {});
    }
  } finally {
    clearSupabaseSession();
    notifySupabaseListeners();
  }
}

export function getCurrentAuthUser(): ClientAuthUser | null {
  return readSupabaseUser();
}

export function subscribeConfiguredAuthState(callback: AuthChangeCallback): () => void {
  supabaseListeners.add(callback);
  callback(readSupabaseUser());

  const storageListener = (event: StorageEvent) => {
    if (
      event.key === SUPABASE_ACCESS_TOKEN_KEY ||
      event.key === SUPABASE_EXPIRES_AT_KEY ||
      event.key === SUPABASE_USER_KEY
    ) {
      callback(readSupabaseUser());
    }
  };

  window.addEventListener("storage", storageListener);

  return () => {
    supabaseListeners.delete(callback);
    window.removeEventListener("storage", storageListener);
  };
}

export async function getCurrentAccessToken(forceRefresh = true): Promise<string | null> {
  if (forceRefresh) {
    return refreshSupabaseAccessTokenIfNeeded();
  }
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SUPABASE_ACCESS_TOKEN_KEY);
}

export async function buildAuthedJsonHeaders() {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = await getCurrentAccessToken(true);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}
