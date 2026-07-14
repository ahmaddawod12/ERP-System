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
  accessToken?: string | null;
}

export interface SupabaseUserRecord {
  disabled?: boolean;
  tokensValidAfterTime?: string | null;
}

interface SupabaseAdminUserPayload {
  id: string;
  banned_until?: unknown;
  deleted_at?: unknown;
}

const BEARER_PREFIX = "Bearer ";

function isSupabaseAdminUserPayload(value: unknown): value is SupabaseAdminUserPayload {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as { id?: unknown }).id === "string"
      && (value as { id: string }).id.trim(),
  );
}

export function parseBearerToken(header: string | null) {
  if (!header) return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

async function verifySupabaseToken(token: string): Promise<VerifiedAccessToken> {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const jwtSecret = String(process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "").trim();
  const jwtIssuer = String(
    process.env.SUPABASE_JWT_ISSUER ||
      (supabaseUrl ? `${supabaseUrl}/auth/v1` : ""),
  ).trim();
  const jwtAudiences = (process.env.SUPABASE_JWT_AUDIENCE || "authenticated")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!jwtSecret) {
    throw new ApiRouteError(500, "jwt_secret_missing", "JWT_SECRET is required for server-side token verification");
  }
  if (!jwtIssuer) {
    throw new ApiRouteError(500, "jwt_issuer_missing", "SUPABASE_JWT_ISSUER is required for server-side token verification");
  }

  let claims: Record<string, unknown> | null;
  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const verified = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: jwtIssuer,
      audience: jwtAudiences.length > 0 ? jwtAudiences : ["authenticated"],
    });
    claims = (verified.payload as Record<string, unknown>) || null;
  } catch {
    throw new ApiRouteError(401, "invalid_token", "Invalid or expired auth token");
  }

  const uid = typeof claims?.sub === "string" ? claims.sub.trim() : "";
  if (!uid) {
    throw new ApiRouteError(401, "invalid_token", "Invalid auth token payload");
  }

  const authTime = Number.isFinite(Number(claims?.iat)) ? Number(claims?.iat) : null;
  const roleFromAppMetadata =
    typeof (claims?.app_metadata as Record<string, unknown> | undefined)?.role === "string"
      ? String((claims.app_metadata as Record<string, unknown>).role)
      : null;

  return {
    uid,
    provider: "supabase",
    decodedToken: null,
    claims,
    authTime,
    email: typeof claims?.email === "string" ? claims.email : null,
    role: roleFromAppMetadata,
    companyId: null,
    accessToken: token,
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

  const payload = (await response.json().catch(() => null)) as
    | ({ user?: unknown } & Partial<SupabaseAdminUserPayload>)
    | null;
  const user = isSupabaseAdminUserPayload(payload?.user)
    ? payload.user
    : isSupabaseAdminUserPayload(payload)
      ? payload
      : null;
  if (!user || user.id.trim() !== normalizedUid) {
    throw new ApiRouteError(401, "invalid_session", "Session user is no longer valid");
  }

  const nowMs = Date.now();
  const bannedUntilMs = Date.parse(String(user.banned_until || ""));
  const disabled = Boolean(user.deleted_at) || (Number.isFinite(bannedUntilMs) && bannedUntilMs > nowMs);
  return {
    disabled,
    // Supabase user timestamps are profile/audit timestamps, not token
    // revocation markers. Strong revocation is enforced by the target opaque
    // web-session store; until then, rely on the access-token expiry instead
    // of rejecting healthy sessions after ordinary user updates.
    tokensValidAfterTime: null,
  };
}
