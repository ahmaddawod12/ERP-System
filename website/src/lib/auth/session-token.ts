import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60;

const SESSION_ISSUER = "smart-job-website";
const SESSION_AUDIENCE = "smart-job-website";

export interface WebsiteSessionPayload {
  uid: string;
  provider: "supabase";
  email?: string | null;
  role?: string | null;
  companyId?: string | null;
  authTime?: number | null;
}

function getSessionSecret(): Uint8Array {
  const rawSecret = String(
    process.env.SESSION_COOKIE_SECRET
      || process.env.WEBSITE_SESSION_SECRET
      || "",
  ).trim();

  if (!rawSecret) {
    throw new Error("Missing session signing secret");
  }

  return new TextEncoder().encode(rawSecret);
}

export async function createSessionCookieValue(payload: WebsiteSessionPayload): Promise<string> {
  const normalizedUid = String(payload.uid || "").trim();
  if (!normalizedUid) {
    throw new Error("Session payload is missing uid");
  }

  return new SignJWT({
    provider: payload.provider,
    email: payload.email || undefined,
    role: payload.role || undefined,
    companyId: payload.companyId || undefined,
    authTime: Number.isFinite(payload.authTime) ? payload.authTime : undefined,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(normalizedUid)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionCookieValue(token: string): Promise<WebsiteSessionPayload | null> {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(normalizedToken, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });

    const uid = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!uid) {
      return null;
    }

    return {
      uid,
      provider: "supabase",
      email: typeof payload.email === "string" ? payload.email : null,
      role: typeof payload.role === "string" ? payload.role : null,
      companyId: typeof payload.companyId === "string" ? payload.companyId : null,
      authTime: Number.isFinite(payload.authTime) ? Number(payload.authTime) : null,
    };
  } catch {
    return null;
  }
}
