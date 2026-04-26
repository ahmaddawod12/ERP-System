import { jwtVerify } from "jose";
import { ApiRouteError } from "../api/errors.ts";

export type AccessTokenProvider = "supabase";

export interface VerifiedAccessToken {
  uid: string;
  provider: AccessTokenProvider;
  decodedToken: null;
  claims: Record<string, unknown> | null;
  authTime: number | null;
  email: string | null;
  role: string | null;
  companyId: string | null;
}

export interface SupabaseUserRecord {
  disabled?: boolean;
  tokensValidAfterTime?: string | null;
}

const BEARER_PREFIX = "Bearer ";

export function parseBearerToken(header: string | null) {
  if (!header) return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function verifySupabaseToken(token: string): Promise<VerifiedAccessToken> {
  const supabaseUrl = String(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  )
    .trim()
    .replace(/\/+$/, "");
  const supabaseApiKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
  ).trim();

  if (!supabaseUrl || !supabaseApiKey) {
    throw new ApiRouteError(500, "supabase_not_configured", "Supabase auth is not configured on server");
  }

  const jwtSecret = String(process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "").trim();
  let claims = decodeJwtPayload(token);
  if (jwtSecret) {
    try {
      const secret = new TextEncoder().encode(jwtSecret);
      const verified = await jwtVerify(token, secret);
      claims = (verified.payload as Record<string, unknown>) || claims;
    } catch {
      // Fall back to server-side introspection for token validity.
    }
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseApiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiRouteError(401, "invalid_token", "Invalid or expired auth token");
  }

  const user = (await response.json().catch(() => null)) as {
    id?: unknown;
    email?: unknown;
    app_metadata?: { role?: unknown };
    user_metadata?: { role?: unknown; companyId?: unknown; company_id?: unknown };
  } | null;

  const uid = String(user?.id ?? "").trim();
  if (!uid) {
    throw new ApiRouteError(401, "invalid_token", "Invalid auth token payload");
  }

  const authTime = Number.isFinite(Number(claims?.iat)) ? Number(claims?.iat) : null;
  const roleFromClaims = typeof claims?.role === "string" ? claims.role : null;
  const roleFromAppMetadata = typeof user?.app_metadata?.role === "string" ? user.app_metadata.role : null;
  const roleFromUserMetadata = typeof user?.user_metadata?.role === "string" ? user.user_metadata.role : null;
  const companyFromClaims = typeof claims?.companyId === "string"
    ? claims.companyId
    : (typeof claims?.company_id === "string" ? claims.company_id : null);
  const companyFromUserMetadata = typeof user?.user_metadata?.companyId === "string"
    ? user.user_metadata.companyId
    : (typeof user?.user_metadata?.company_id === "string" ? user.user_metadata.company_id : null);

  return {
    uid,
    provider: "supabase",
    decodedToken: null,
    claims,
    authTime,
    email: typeof user?.email === "string" ? user.email : null,
    role: roleFromClaims || roleFromAppMetadata || roleFromUserMetadata,
    companyId: companyFromClaims || companyFromUserMetadata,
  };
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  return verifySupabaseToken(token);
}

export async function getSupabaseUserByUid(uid: string): Promise<SupabaseUserRecord> {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new ApiRouteError(400, "invalid_uid", "uid is required");
  }

  const supabaseUrl = String(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  )
    .trim()
    .replace(/\/+$/, "");
  const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new ApiRouteError(500, "supabase_not_configured", "Supabase admin auth is not configured on server");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(normalizedUid)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      apikey: supabaseServiceRoleKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiRouteError(401, "invalid_session", "Session user is no longer valid");
  }

  const payload = (await response.json().catch(() => null)) as {
    user?: {
      banned_until?: unknown;
      deleted_at?: unknown;
      updated_at?: unknown;
      last_sign_in_at?: unknown;
    };
  } | null;
  const user = payload?.user;
  if (!user) {
    throw new ApiRouteError(401, "invalid_session", "Session user is no longer valid");
  }

  const nowMs = Date.now();
  const bannedUntilMs = Date.parse(String(user.banned_until || ""));
  const disabled = Boolean(user.deleted_at) || (Number.isFinite(bannedUntilMs) && bannedUntilMs > nowMs);
  const updatedAt = String(user.updated_at || "").trim();
  const lastSignInAt = String(user.last_sign_in_at || "").trim();
  const tokensValidAfterTime = updatedAt || lastSignInAt || null;

  return {
    disabled,
    tokensValidAfterTime,
  };
}
