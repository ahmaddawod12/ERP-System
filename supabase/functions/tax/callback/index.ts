import { 
  getEnv, 
  handleOptions, 
  handleHttpError,
  buildHttpResponse, 
  buildSuccessResponse,
  StructuredLogger,
  generateCorrelationId,
  getCorsHeaders,
  createSupabaseClient,
} from "../../../shared-edge-helpers.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";

const env = getEnv();

/**
 * Tax Authority OAuth Callback Endpoint
 * 
 * Unauthenticated webhook for receiving tax authority OAuth callbacks.
 * Validates callback signature/token before processing.
 * Idempotent: Multiple requests with same data return same result.
 * 
 * Contract: PHASE-0-CONTRACTS.md (Tax callback section)
 * Phase: 3 (Implementation)
 * 
 * Request (Pub/Sub Push):
 * POST /tax/callback
 * Content-Type: application/json
 * x-pubsub-token: {HMAC signature or OIDC token}
 * 
 * {
 *   "message": {
 *     "data": base64({
 *       "oauthSessionId": string,
 *       "status": "approved" | "rejected" | "error",
 *       "confirmationNumber"?: string,
 *       "errorMessage"?: string
 *     })
 *   }
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "data": {
 *     "processed": true,
 *     "confirmationNumber"?: string
 *   }
 * }
 */

function decodeBase64(str: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(str), c => c.charCodeAt(0)));
  } catch {
    throw {
      code: "invalid-argument",
      httpStatus: 400,
      message: "Invalid base64 encoding in message data"
    };
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

function parseAuthorizationBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (String(scheme || "").toLowerCase() !== "bearer") return null;
  const normalized = String(token || "").trim();
  return normalized || null;
}

const GOOGLE_OIDC_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

async function verifyPubSubOidcToken(req: Request): Promise<boolean> {
  const token = parseAuthorizationBearer(req.headers.get("authorization"));
  if (!token) return false;

  const expectedAudience = String(
    Deno.env.get("TAX_CALLBACK_OIDC_AUDIENCE") ||
    `${String(env.supabaseUrl || "").replace(/\/+$/, "")}/functions/v1/tax/callback`,
  ).trim();

  const allowedServiceAccounts = String(Deno.env.get("PUBSUB_ALLOWED_SERVICE_ACCOUNTS") || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  try {
    const verified = await jwtVerify(token, GOOGLE_OIDC_JWKS, {
      audience: expectedAudience || undefined,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const claims = verified.payload as Record<string, unknown>;
    const email = String(claims.email || "").trim().toLowerCase();
    if (allowedServiceAccounts.length > 0 && !allowedServiceAccounts.includes(email)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function verifyPubSubRequest(req: Request): Promise<boolean> {
  const providedSharedToken = String(req.headers.get("x-pubsub-token") || "").trim();
  const configuredSharedToken = String(
    Deno.env.get("TAX_CALLBACK_SHARED_TOKEN") || Deno.env.get("PUBSUB_VERIFICATION_TOKEN") || "",
  ).trim();

  if (configuredSharedToken && providedSharedToken && providedSharedToken === configuredSharedToken) {
    return true;
  }

  return verifyPubSubOidcToken(req);
}

// ── Main Handler ────────────────────────────────────────────────────────────
async function handleTaxCallbackRequest(req: Request): Promise<Response> {
  const correlationId = generateCorrelationId();
  const logger = new StructuredLogger(correlationId, "info");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"), env.corsAllowedOrigins);
    return buildHttpResponse(204, {}, corsHeaders);
  }

  if (req.method !== "POST") {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"), env.corsAllowedOrigins);
    return buildHttpResponse(
      405,
      {
        ok: false,
        error: {
          code: "invalid-argument",
          message: "Only POST is allowed"
        }
      },
      corsHeaders
    );
  }

  try {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"), env.corsAllowedOrigins);

    const pubsubVerified = await verifyPubSubRequest(req);
    if (!pubsubVerified) {
      logger.warn("Tax callback token verification failed", { correlationId });
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Invalid callback authentication"
      };
    }

    const body = await req.json().catch(() => null) as { message?: { data?: unknown } } | null;
    const messageData = body?.message?.data;
    if (!messageData || typeof messageData !== "string") {
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: "message.data is required and must be a base64-encoded string"
      };
    }

    const decodedJson = decodeBase64(messageData);
    const payload = JSON.parse(decodedJson) as Record<string, unknown>;

    const oauthSessionId = String(payload?.oauthSessionId || "").trim();
    const status = String(payload?.status || "").trim().toLowerCase();
    const confirmationNumber = String(payload?.confirmationNumber || "").trim() || null;
    const errorMessage = String(payload?.errorMessage || "").trim() || null;

    logger.info("Tax callback received", {
      oauthSessionId,
      status,
      correlationId
    });

    if (!oauthSessionId || !status) {
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: "oauthSessionId and status are required"
      };
    }

    if (!["approved", "rejected", "error"].includes(status)) {
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: `Invalid status: ${status}. Must be one of: approved, rejected, error`
      };
    }

    const supabase = createSupabaseClient(env);
    const callbackHash = await sha256Hex(decodedJson);
    const nowIso = new Date().toISOString();

    const { data: oauthSession, error: sessionLoadError } = await supabase
      .from("tax_oauth_sessions")
      .select("id, status, company_id, expires_at, used_at")
      .eq("id", oauthSessionId)
      .maybeSingle();

    if (sessionLoadError) {
      throw {
        code: "internal",
        httpStatus: 500,
        message: `Failed to load OAuth session: ${sessionLoadError.message}`,
      };
    }

    if (!oauthSession?.id) {
      throw {
        code: "not-found",
        httpStatus: 404,
        message: "OAuth session not found",
      };
    }

    const expiresAtMs = Number(new Date(String(oauthSession.expires_at || "")).getTime());
    if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs < Date.now()) {
      throw {
        code: "failed-precondition",
        httpStatus: 400,
        message: "OAuth session has expired",
      };
    }

    const { data: existingCallback, error: existingCallbackError } = await supabase
      .from("tax_oauth_callbacks")
      .select("id, used, token_exchange_success, token_exchange_error")
      .eq("oauth_session_id", oauthSessionId)
      .eq("code_hash", callbackHash)
      .maybeSingle();

    if (existingCallbackError) {
      throw {
        code: "internal",
        httpStatus: 500,
        message: `Failed to check callback idempotency: ${existingCallbackError.message}`,
      };
    }

    if (existingCallback?.id && existingCallback.used === true) {
      return buildHttpResponse(
        200,
        buildSuccessResponse({
          processed: true,
          confirmationNumber,
          callbackId: existingCallback.id,
          idempotentReplay: true,
        }),
        corsHeaders,
      );
    }

    const tokenExchangeSuccess = status === "approved";
    const tokenExchangeError = tokenExchangeSuccess
      ? null
      : (errorMessage || `Tax callback status=${status}`);

    let callbackId = existingCallback?.id || null;
    if (!callbackId) {
      const { data: insertedCallback, error: insertCallbackError } = await supabase
        .from("tax_oauth_callbacks")
        .insert({
          oauth_session_id: oauthSessionId,
          code_hash: callbackHash,
          received_at: nowIso,
          used: false,
          created_at: nowIso,
        })
        .select("id")
        .single();

      if (insertCallbackError || !insertedCallback?.id) {
        throw {
          code: "internal",
          httpStatus: 500,
          message: `Failed to record callback receipt: ${insertCallbackError?.message || "unknown error"}`,
        };
      }
      callbackId = insertedCallback.id;
    }

    const { error: finalizeCallbackError } = await supabase
      .from("tax_oauth_callbacks")
      .update({
        used: true,
        token_exchange_success: tokenExchangeSuccess,
        token_exchange_error: tokenExchangeError,
        token_exchange_attempted_at: nowIso,
      })
      .eq("id", callbackId);

    if (finalizeCallbackError) {
      throw {
        code: "internal",
        httpStatus: 500,
        message: `Failed to finalize callback: ${finalizeCallbackError.message}`,
      };
    }

    const nextSessionStatus = tokenExchangeSuccess ? "used" : "failed";
    const { error: updateSessionError } = await supabase
      .from("tax_oauth_sessions")
      .update({
        status: nextSessionStatus,
        used_at: oauthSession.used_at || nowIso,
      })
      .eq("id", oauthSessionId);

    if (updateSessionError) {
      throw {
        code: "internal",
        httpStatus: 500,
        message: `Failed to update OAuth session: ${updateSessionError.message}`,
      };
    }

    logger.info("Tax callback processed", {
      oauthSessionId,
      status,
      callbackId,
      correlationId
    });

    const response: Record<string, unknown> = {
      processed: true,
      callbackId,
      tokenExchanged: tokenExchangeSuccess,
      ...(confirmationNumber ? { confirmationNumber } : {}),
    };

    return buildHttpResponse(
      200,
      buildSuccessResponse(response),
      corsHeaders
    );
  } catch (error) {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"), env.corsAllowedOrigins);
    logger.error("Tax callback failed", {
      error: error instanceof Error ? error.message : String(error),
      correlationId
    });
    return handleHttpError(error, corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleTaxCallbackRequest;

export const handler = handleTaxCallbackRequest;

const taxCallbackServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof taxCallbackServe === "function") {
  taxCallbackServe(handleTaxCallbackRequest);
}
