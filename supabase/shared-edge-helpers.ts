import { createClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";

// ─────────────────────────────────────────────────────────────────────────
// Supabase Edge Functions Shared Infrastructure
// Phase 1: Platform Skeleton with Bearer Auth, Request Parsing, CORS, Error Mapping
// ─────────────────────────────────────────────────────────────────────────

// ── Environment and Secrets ───────────────────────────────────────────────
export const getEnv = () => ({
  // Core
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",

  // JWT Secret for Supabase
  jwtSecret: Deno.env.get("JWT_SECRET") || "",

  // SQL / Database
  databaseUrl: Deno.env.get("DATABASE_URL") || "",

  // Cloud Run Integration
  cloudRunPdfService: Deno.env.get("CLOUD_RUN_PDF_SERVICE_URL") || "",
  cloudRunArchiverService: Deno.env.get("CLOUD_RUN_ARCHIVER_SERVICE_URL") || "",

  // Tax Authority
  taxOAuthClientId: Deno.env.get("TAX_CLIENT_ID") || Deno.env.get("TAX_OAUTH_CLIENT_ID") || "",
  taxOAuthClientSecret: Deno.env.get("TAX_CLIENT_SECRET") || Deno.env.get("TAX_OAUTH_CLIENT_SECRET") || "",
  taxAuthorityApiUrl: Deno.env.get("TAX_AUTH_URL") || Deno.env.get("TAX_AUTHORITY_API_URL") || "",
  taxTokenUrl: Deno.env.get("TAX_TOKEN_URL") || "",
  taxApprovalUrl: Deno.env.get("TAX_APPROVAL_URL") || "",

  // Notifications
  pubSubProjectId: Deno.env.get("GCP_PROJECT_ID") || "",
  pubSubTopic: Deno.env.get("PUBSUB_TOPIC") || "document-generate",

  // CORS and Runtime
  corsAllowedOrigins: (Deno.env.get("CORS_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Feature Flags
  enableSqlPersistence: (
    String(Deno.env.get("SMART_JOB_PERSISTENCE_BACKEND") || Deno.env.get("PERSISTENCE_BACKEND") || "")
      .trim()
      .toLowerCase() === "sql"
  ) || Deno.env.get("ENABLE_SQL_PERSISTENCE") === "true",
  logLevel: Deno.env.get("LOG_LEVEL") || "info",
});

// ── Structured Logging with Correlation ID ────────────────────────────────
export class StructuredLogger {
  private correlationId: string;
  private logLevel: "debug" | "info" | "warn" | "error";

  constructor(correlationId: string, logLevel: "debug" | "info" | "warn" | "error" = "info") {
    this.correlationId = correlationId;
    this.logLevel = logLevel;
  }

  private shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  private formatLog(level: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      correlationId: this.correlationId,
      level,
      message,
      ...(data && { data }),
    };
    return JSON.stringify(logEntry);
  }

  debug(message: string, data?: any) {
    if (this.shouldLog("debug")) console.log(this.formatLog("DEBUG", message, data));
  }

  info(message: string, data?: any) {
    if (this.shouldLog("info")) console.log(this.formatLog("INFO", message, data));
  }

  warn(message: string, data?: any) {
    if (this.shouldLog("warn")) console.warn(this.formatLog("WARN", message, data));
  }

  error(message: string, data?: any) {
    if (this.shouldLog("error")) console.error(this.formatLog("ERROR", message, data));
  }
}

// ── Request Correlation ID Generator ───────────────────────────────────────
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

// ── Bearer Token Parsing ───────────────────────────────────────────────────
export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

// ── JWT Verification (Supabase) ────────────────────────────────────────────
export async function verifySupabaseJwt(
  token: string,
  jwtSecret: string
): Promise<{ uid: string; email?: string; [key: string]: any } | null> {
  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const verified = await jwtVerify(token, secret);
    const claims = verified.payload as any;
    return {
      uid: claims.sub || claims.uid,
      email: claims.email,
      ...claims,
    };
  } catch {
    return null;
  }
}

// ── Unified Auth Verification ──────────────────────────────────────────────
export async function verifyBearerAuth(
  token: string,
  env: ReturnType<typeof getEnv>
): Promise<{ uid: string; email?: string; claims: any } | null> {
  if (!token) return null;

  const supabaseClaims = await verifySupabaseJwt(token, env.jwtSecret);
  if (supabaseClaims) {
    return {
      uid: supabaseClaims.uid,
      email: supabaseClaims.email,
      claims: supabaseClaims,
    };
  }

  return null;
}

// ── CORS Headers Builder ───────────────────────────────────────────────────
export function getCorsHeaders(
  origin: string | null,
  allowedOrigins: string[]
): Record<string, string> {
  const normalizedOrigin = typeof origin === "string" ? origin.trim() : "";
  const isAllowed = normalizedOrigin.length > 0 && allowedOrigins.includes(normalizedOrigin);

  const allowOrigin = isAllowed
    ? normalizedOrigin
    : "";
  const allowCredentials = allowOrigin.length > 0 ? "true" : "false";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE, PUT",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": allowCredentials,
    "Vary": "Origin",
  };
}

// ── HTTP Status from Error Code ────────────────────────────────────────────
export function httpStatusFromErrorCode(code: string): number {
  const mapping: Record<string, number> = {
    "invalid-argument": 400,
    "permission-denied": 403,
    "not-found": 404,
    "already-exists": 409,
    "unauthenticated": 401,
    "resource-exhausted": 429,
    "internal": 500,
    "unavailable": 503,
    "deadline-exceeded": 504,
  };
  return mapping[code] || 500;
}

// ── Error Response Builder ─────────────────────────────────────────────────
export function buildErrorResponse(
  code: string,
  message: string,
  details?: Record<string, any>
) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

// ── Success Response Builder ───────────────────────────────────────────────
export function buildSuccessResponse(data: any, meta?: Record<string, any>) {
  return {
    ok: true,
    data,
    ...(meta && { meta }),
  };
}

// ── Request Body Parser ────────────────────────────────────────────────────
export async function parseJsonBody(req: Request): Promise<any> {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Content-Type must be application/json");
    }
    return await req.json();
  } catch (error) {
    throw {
      code: "invalid-argument",
      message: "Invalid JSON body",
      httpStatus: 400,
      cause: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Response Builder (HTTP) ────────────────────────────────────────────────
export function buildHttpResponse(
  statusCode: number,
  body: Record<string, any>,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// ── Catch-All HTTP Error Handler ───────────────────────────────────────────
export function handleHttpError(
  error: any,
  corsHeaders: Record<string, string> = {}
): Response {
  const code = error?.code || "internal";
  const message = error?.message || "An unknown error occurred";
  const statusCode = error?.httpStatus || httpStatusFromErrorCode(code);

  const responseBody = buildErrorResponse(code, message, error?.details);
  return buildHttpResponse(statusCode, responseBody, corsHeaders);
}

// ── Typed HTTP Endpoint Builder ────────────────────────────────────────────
export interface EdgeFunctionContext {
  correlationId: string;
  logger: StructuredLogger;
  auth: { uid: string; email?: string; claims: any } | null;
  env: ReturnType<typeof getEnv>;
  corsHeaders: Record<string, string>;
}

export async function createEdgeFunctionContext(
  req: Request,
  env: ReturnType<typeof getEnv>
): Promise<EdgeFunctionContext> {
  const correlationId = req.headers.get("X-Request-ID") || generateCorrelationId();
  const logger = new StructuredLogger(correlationId, (env.logLevel as any) || "info");

  const authHeader = req.headers.get("authorization");
  const token = parseBearerToken(authHeader);
  const auth = token ? await verifyBearerAuth(token, env) : null;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin, env.corsAllowedOrigins);

  return {
    correlationId,
    logger,
    auth,
    env,
    corsHeaders,
  };
}

// ── OPTIONS Request Handler (CORS Preflight) ───────────────────────────────
export function handleOptions(corsHeaders: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ── Validation Helpers ─────────────────────────────────────────────────────
export function requireNonEmptyString(
  value: any,
  fieldName: string,
  min = 1,
  max = 2000
): string {
  if (typeof value !== "string" || value.trim().length < min) {
    throw {
      code: "invalid-argument",
      message: `${fieldName} must be a non-empty string`,
      httpStatus: 400,
    };
  }
  if (value.length > max) {
    throw {
      code: "invalid-argument",
      message: `${fieldName} must be at most ${max} characters`,
      httpStatus: 400,
    };
  }
  return value.trim();
}

export function optionalTrimmedString(value: any, max = 2000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > max) {
    throw {
      code: "invalid-argument",
      message: `String field must be at most ${max} characters`,
      httpStatus: 400,
    };
  }
  return trimmed;
}

export function validateCompanyId(companyId: any): string {
  if (typeof companyId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(companyId)) {
    throw {
      code: "invalid-argument",
      message: "companyId must be alphanumeric with underscores or hyphens",
      httpStatus: 400,
    };
  }
  return companyId;
}

export function validateEmail(email: any): string {
  const trimmed = requireNonEmptyString(email, "email", 1, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    throw {
      code: "invalid-argument",
      message: "Invalid email format",
      httpStatus: 400,
    };
  }
  return trimmed;
}

export async function resolveCompanyIdentifiers(
  companyId: string,
  env: ReturnType<typeof getEnv>
): Promise<{ internalCompanyId: string; publicCompanyId: string }> {
  const normalized = validateCompanyId(companyId);
  const supabase = createSupabaseClient(env);

  let query = supabase
    .from("companies")
    .select("id, public_company_id")
    .eq("id", normalized)
    .limit(1);

  const numericCandidate = Number(normalized);
  if (Number.isInteger(numericCandidate) && numericCandidate > 0) {
    query = supabase
      .from("companies")
      .select("id, public_company_id")
      .or(`id.eq.${normalized},public_company_id.eq.${numericCandidate}`)
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.id) {
    throw {
      code: "not-found",
      message: "Company not found",
      httpStatus: 404,
    };
  }

  return {
    internalCompanyId: String(data.id),
    publicCompanyId: String(data.public_company_id || normalized),
  };
}

// ── Company Access Check Helper ────────────────────────────────────────────
export async function assertCompanyAccess(
  uid: string,
  companyId: string,
  requiredRole: string[] | string = [],
  ctx: EdgeFunctionContext
): Promise<void> {
  if (!uid) {
    throw {
      code: "unauthenticated",
      message: "Authentication required",
      httpStatus: 401,
    };
  }

  ctx.logger.debug("Checking company access", { uid, companyId, requiredRole });

  const supabase = createSupabaseClient(ctx.env);
  const requiredRoles = Array.isArray(requiredRole)
    ? requiredRole.map((role) => String(role || "").trim()).filter(Boolean)
    : [String(requiredRole || "").trim()].filter(Boolean);

  const { data: user } = await supabase
    .from("app_users")
    .select("system_role")
    .eq("id", uid)
    .maybeSingle();

  if (
    ctx.auth?.claims?.role === "dev" ||
    String(user?.system_role || "").toLowerCase() === "dev"
  ) {
    ctx.logger.debug("Dev role bypasses company check", { uid, companyId });
    return;
  }

  const resolvedCompany = await resolveCompanyIdentifiers(companyId, ctx.env);
  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("role, status")
    .eq("company_id", resolvedCompany.internalCompanyId)
    .eq("user_id", uid)
    .eq("status", "active")
    .maybeSingle();

  if (error || !membership) {
    throw {
      code: "permission-denied",
      message: "Not allowed for this company",
      httpStatus: 403,
    };
  }

  if (requiredRoles.length > 0 && !requiredRoles.includes(String(membership.role || ""))) {
    throw {
      code: "permission-denied",
      message: "Role does not have access to this company resource",
      httpStatus: 403,
    };
  }
}

// ── Rate Limiting Helper ────────────────────────────────────────────────────
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  ctx: EdgeFunctionContext
): Promise<void> {
  ctx.logger.debug("Checking rate limit", { key, maxRequests, windowMs });

  const rawKey = String(key || "").trim();
  if (!rawKey) {
    return;
  }

  const safeWindowMs = Math.max(1_000, Number(windowMs || 60_000) || 60_000);
  const safeMaxRequests = Math.max(1, Number(maxRequests || 5) || 5);
  const nowMs = Date.now();
  const bucket = Math.floor(nowMs / safeWindowMs);
  const bucketStartMs = bucket * safeWindowMs;
  const resetAtMs = bucketStartMs + safeWindowMs;
  const expireAtMs = resetAtMs + safeWindowMs;

  const encoder = new TextEncoder();
  const hashHex = async (value: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(digest))
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("");
  };

  const hashedKey = await hashHex(rawKey);
  const bucketKey = await hashHex(`${rawKey}:${safeWindowMs}:${safeMaxRequests}:${bucket}`);
  const supabase = createSupabaseClient(ctx.env);

  // Atomic upsert: INSERT … ON CONFLICT DO UPDATE, returns new hit_count
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("increment_rate_limit_bucket", {
      p_bucket_key: bucketKey,
      p_hashed_key: hashedKey,
      p_window_started_at: new Date(bucketStartMs).toISOString(),
      p_expire_at: new Date(expireAtMs).toISOString(),
    });

  if (rpcError) {
    ctx.logger.warn("Rate limit RPC failed; allowing request", { key: rawKey, error: rpcError.message });
    return;
  }

  const hitCount = Number(rpcData ?? 0);
  if (hitCount > safeMaxRequests) {
    throw {
      code: "resource-exhausted",
      message: "Too many requests. Please try again later.",
      httpStatus: 429,
      details: {
        resetAt: new Date(resetAtMs).toISOString(),
      },
    };
  }
}

// ── Idempotency Helper ──────────────────────────────────────────────────────
export async function checkIdempotency(
  idempotencyKey: string | undefined,
  uid: string,
  operationName: string,
  ctx: EdgeFunctionContext,
  scope?: {
    companyId?: string;
  }
): Promise<any | null> {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) return null;

  const companyIdRaw = String(scope?.companyId || "").trim();
  if (!companyIdRaw) return null;

  ctx.logger.debug("Checking idempotency", { uid, operationName });

  const company = await resolveCompanyIdentifiers(companyIdRaw, ctx.env);
  const supabase = createSupabaseClient(ctx.env);
  const idempotencyHash = await sha256Hex(`${operationName}:${company.internalCompanyId}:${normalizedKey}`);

  const { data: row, error } = await supabase
    .from("tax_invoice_idempotency")
    .select("status, result_payload")
    .eq("company_id", company.internalCompanyId)
    .eq("idempotency_hash", idempotencyHash)
    .maybeSingle();

  if (error) {
    ctx.logger.warn("Idempotency lookup failed", { operationName, error: error.message });
    return null;
  }

  if (!row) {
    return null;
  }

  const status = String(row.status || "").toLowerCase();
  if (status === "approved") {
    return row.result_payload || { success: true, replayed: true };
  }

  if (status === "in_progress") {
    throw {
      code: "already-exists",
      httpStatus: 409,
      message: "An equivalent request is already in progress",
    };
  }

  return null;
}

export async function claimIdempotency(
  idempotencyKey: string | undefined,
  uid: string,
  operationName: string,
  ctx: EdgeFunctionContext,
  scope?: {
    companyId?: string;
    expireAt?: string;
  }
): Promise<{ status: "acquired" | "approved" | "in_progress"; result: any | null }> {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) {
    return { status: "acquired", result: null };
  }

  const companyIdRaw = String(scope?.companyId || "").trim();
  if (!companyIdRaw) {
    return { status: "acquired", result: null };
  }

  const company = await resolveCompanyIdentifiers(companyIdRaw, ctx.env);
  const supabase = createSupabaseClient(ctx.env);
  const idempotencyHash = await sha256Hex(`${operationName}:${company.internalCompanyId}:${normalizedKey}`);
  const expireAt = scope?.expireAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc("claim_tax_invoice_idempotency", {
    p_company_id: company.internalCompanyId,
    p_user_id: uid,
    p_idempotency_hash: idempotencyHash,
    p_request_hash: idempotencyHash,
    p_expire_at: expireAt,
  });

  if (error) {
    throw {
      code: "internal",
      httpStatus: 500,
      message: `Failed to claim idempotency state: ${error.message}`,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const status = String(row?.claim_status || "").trim().toLowerCase();
  if (status === "approved") {
    return { status: "approved", result: row?.result_payload || { success: true, replayed: true } };
  }
  if (status === "in_progress") {
    return { status: "in_progress", result: null };
  }
  return { status: "acquired", result: null };
}

export async function recordIdempotencyResult(
  idempotencyKey: string,
  uid: string,
  operationName: string,
  result: any,
  ctx: EdgeFunctionContext,
  scope?: {
    companyId?: string;
    status?: "in_progress" | "approved" | "failed";
    expireAt?: string;
  }
): Promise<void> {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) return;

  const companyIdRaw = String(scope?.companyId || "").trim();
  if (!companyIdRaw) return;

  const company = await resolveCompanyIdentifiers(companyIdRaw, ctx.env);
  const supabase = createSupabaseClient(ctx.env);
  const nowIso = new Date().toISOString();
  const idempotencyHash = await sha256Hex(`${operationName}:${company.internalCompanyId}:${normalizedKey}`);

  const status = scope?.status || "approved";
  const expireAt = scope?.expireAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("tax_invoice_idempotency")
    .upsert({
      company_id: company.internalCompanyId,
      idempotency_hash: idempotencyHash,
      user_id: uid,
      status,
      request_hash: idempotencyHash,
      result_payload: result,
      locked_at: nowIso,
      expire_at: expireAt,
      updated_at: nowIso,
    }, { onConflict: "company_id,idempotency_hash" });

  if (error) {
    throw {
      code: "internal",
      httpStatus: 500,
      message: `Failed to persist idempotency state: ${error.message}`,
    };
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export async function allocateNextCompanyCounter(
  companyId: string,
  counterKey: string,
  ctx: EdgeFunctionContext,
): Promise<number> {
  const normalizedCounterKey = String(counterKey || "").trim();
  if (!normalizedCounterKey) {
    throw { code: "invalid-argument", message: "counterKey is required", httpStatus: 400 };
  }

  const resolved = await resolveCompanyIdentifiers(companyId, ctx.env);
  const supabase = createSupabaseClient(ctx.env);

  const { data, error } = await supabase.rpc("allocate_company_counter", {
    p_company_id: resolved.internalCompanyId,
    p_counter_key: normalizedCounterKey,
  });

  if (error) {
    throw {
      code: "internal",
      httpStatus: 500,
      message: `Failed to allocate company counter ${normalizedCounterKey}: ${error.message}`,
    };
  }

  return Number(data);
}

export async function allocateNextSystemCounter(
  counterKey: string,
  ctx: EdgeFunctionContext,
  startAt = 1,
): Promise<number> {
  const normalizedCounterKey = String(counterKey || "").trim();
  if (!normalizedCounterKey) {
    throw { code: "invalid-argument", message: "counterKey is required", httpStatus: 400 };
  }

  const seed = Math.max(1, Number(startAt || 1) || 1);
  const supabase = createSupabaseClient(ctx.env);

  const { data, error } = await supabase.rpc("allocate_system_counter", {
    p_counter_key: normalizedCounterKey,
    p_start_at: seed,
  });

  if (error) {
    throw {
      code: "internal",
      httpStatus: 500,
      message: `Failed to allocate system counter ${normalizedCounterKey}: ${error.message}`,
    };
  }

  return Number(data);
}

// ── Supabase Client Helper ──────────────────────────────────────────────────
export function createSupabaseClient(env: ReturnType<typeof getEnv>) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signGoogleServiceAccountJwt(
  serviceAccountEmail: string,
  privateKeyPem: string,
  audience: string,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 10;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: audience,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encoder = new TextEncoder();
  const encodedHeader = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyData = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const keyBytes = new Uint8Array(decodeBase64Url(keyData));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${encodedSignature}`;
}

async function createCloudRunOidcToken(audience: string): Promise<string | null> {
  const serviceAccountEmail = String(
    Deno.env.get("GCP_SERVICE_ACCOUNT_EMAIL") || Deno.env.get("GOOGLE_CLIENT_EMAIL") || "",
  ).trim();
  const privateKey = String(
    Deno.env.get("GCP_SERVICE_ACCOUNT_PRIVATE_KEY") || Deno.env.get("GOOGLE_PRIVATE_KEY") || "",
  ).replace(/\\n/g, "\n").trim();

  if (!serviceAccountEmail || !privateKey || !audience) {
    return null;
  }

  return signGoogleServiceAccountJwt(serviceAccountEmail, privateKey, audience);
}

export async function dispatchCloudRunPdfTask(
  path: "/preview" | "/generate",
  payload: Record<string, unknown>,
  env: ReturnType<typeof getEnv>,
): Promise<void> {
  const serviceBaseUrl = trimTrailingSlash(String(env.cloudRunPdfService || "").trim());
  if (!serviceBaseUrl) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: "CLOUD_RUN_PDF_SERVICE_URL is not configured",
    };
  }

  const targetUrl = `${serviceBaseUrl}${path}`;
  const oidcToken = await createCloudRunOidcToken(serviceBaseUrl);
  const sharedToken = String(Deno.env.get("PUBSUB_VERIFICATION_TOKEN") || "").trim();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (oidcToken) {
    headers.set("Authorization", `Bearer ${oidcToken}`);
  }
  if (sharedToken) {
    headers.set("x-pubsub-token", sharedToken);
  }

  const body = {
    message: {
      data: btoa(JSON.stringify(payload)),
    },
  };

  const response = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: `Failed to dispatch PDF task (${response.status})`,
    };
  }
}

// ── PII Redaction ───────────────────────────────────────────────────────────
export function redactEmail(email: string): string {
  if (!email || typeof email !== "string") return "[none]";
  const parts = email.split("@");
  if (parts.length !== 2) return "[invalid]";
  const [local, domain] = parts;
  const domainParts = domain.split(".");
  const tld = domainParts.pop();
  const domainName = domainParts.join(".");
  return `${local[0]}***@${domainName[0]}***.${tld}`;
}

// ── Exports ────────────────────────────────────────────────────────────────
export {
  createClient as createSupabaseClientTyped,
  SupabaseClient,
} from "@supabase/supabase-js";
