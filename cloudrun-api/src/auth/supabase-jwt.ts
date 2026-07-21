import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

import {
  isCompactJwt,
  parseBearerAuthorization,
  type AuthorizationHeader,
} from "./authorization.js";
import { AuthError } from "./errors.js";

export const SUPABASE_ASYMMETRIC_JWT_ALGORITHMS = Object.freeze(["ES256", "RS256"] as const);

const REQUIRED_CLAIMS = ["iss", "aud", "exp", "sub"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface AuthenticatedUser {
  readonly userId: string;
  readonly expiresAt: number;
}

export interface SupabaseJwtVerifier {
  readonly issuer: string;
  readonly audiences: readonly string[];
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
  verifyAuthorizationHeader(header: AuthorizationHeader): Promise<AuthenticatedUser>;
}

export interface SupabaseJwtVerifierOptions {
  /** Exact value expected in the Supabase access token `iss` claim. */
  readonly issuer: string;
  /** One or more accepted access-token audiences. */
  readonly audiences: string | readonly string[];
  /** Injectable key resolver for deterministic tests or an explicitly managed JWKS. */
  readonly jwks?: JWTVerifyGetKey;
  /** Optional separately-routable JWKS endpoint; the token issuer remains unchanged. */
  readonly jwksUrl?: URL;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function normalizeIssuer(value: string): { readonly issuer: string; readonly jwksUrl: URL } {
  const issuer = value.trim();
  if (issuer.length === 0 || issuer !== value) {
    throw new TypeError("Supabase JWT issuer must be a non-empty URL without surrounding whitespace");
  }

  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new TypeError("Supabase JWT issuer must be a valid URL");
  }

  const secureTransport = url.protocol === "https:";
  const localDevelopmentTransport = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!secureTransport && !localDevelopmentTransport) {
    throw new TypeError("Supabase JWT issuer must use HTTPS outside loopback development");
  }

  if (
    url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
    || url.pathname !== "/auth/v1"
  ) {
    throw new TypeError("Supabase JWT issuer must be an Auth endpoint ending in /auth/v1");
  }

  const canonicalIssuer = url.toString();
  const jwksUrl = new URL(`${canonicalIssuer}/.well-known/jwks.json`);
  return { issuer: canonicalIssuer, jwksUrl };
}

function normalizeAudiences(value: string | readonly string[]): readonly string[] {
  const candidates = typeof value === "string" ? [value] : [...value];
  if (candidates.length === 0) {
    throw new TypeError("At least one Supabase JWT audience must be configured");
  }

  const audiences: string[] = [];
  for (const candidate of candidates) {
    if (candidate.length === 0 || candidate.trim() !== candidate) {
      throw new TypeError("Supabase JWT audiences must be non-empty and contain no surrounding whitespace");
    }
    if (!audiences.includes(candidate)) {
      audiences.push(candidate);
    }
  }

  return Object.freeze(audiences);
}

function isUnavailableVerificationError(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWKSTimeout
    || error instanceof joseErrors.JWKSInvalid
    || error instanceof joseErrors.JWKInvalid
    || error instanceof joseErrors.JWKSMultipleMatchingKeys
    || (error instanceof joseErrors.JOSEError && error.code === "ERR_JOSE_GENERIC")
    || !(error instanceof joseErrors.JOSEError)
  );
}

function mapVerificationError(error: unknown): AuthError {
  if (error instanceof AuthError) {
    return error;
  }
  if (error instanceof joseErrors.JWTExpired) {
    return new AuthError("ACCESS_TOKEN_EXPIRED");
  }
  if (isUnavailableVerificationError(error)) {
    return new AuthError("AUTH_VERIFICATION_UNAVAILABLE");
  }
  return new AuthError("AUTHORIZATION_INVALID");
}

function requireUserId(subject: unknown): string {
  if (typeof subject !== "string" || !UUID_PATTERN.test(subject) || subject.toLowerCase() === NIL_UUID) {
    throw new AuthError("AUTHORIZATION_INVALID");
  }
  return subject.toLowerCase();
}

export function createSupabaseJwtVerifier(
  options: SupabaseJwtVerifierOptions,
): SupabaseJwtVerifier {
  const normalized = normalizeIssuer(options.issuer);
  const { issuer } = normalized;
  const jwksUrl = options.jwksUrl ?? normalized.jwksUrl;
  const issuerUrl = new URL(issuer);
  const localRoutableJwks = jwksUrl.protocol === "http:"
    && isLoopbackHost(issuerUrl.hostname);
  if (
    (jwksUrl.protocol !== "https:" && !localRoutableJwks)
    || jwksUrl.username
    || jwksUrl.password
    || jwksUrl.search
    || jwksUrl.hash
    || jwksUrl.pathname !== "/auth/v1/.well-known/jwks.json"
  ) {
    throw new TypeError("Supabase JWKS URL must be a safe Auth JWKS endpoint");
  }
  const audiences = normalizeAudiences(options.audiences);
  const jwks = options.jwks ?? createRemoteJWKSet(jwksUrl, {
    cacheMaxAge: 600_000,
    cooldownDuration: 30_000,
    timeoutDuration: 3_000,
  });

  const verifyAccessToken = async (token: string): Promise<AuthenticatedUser> => {
    if (!isCompactJwt(token)) {
      throw new AuthError("AUTHORIZATION_INVALID");
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: [...SUPABASE_ASYMMETRIC_JWT_ALGORITHMS],
        audience: [...audiences],
        issuer,
        typ: "JWT",
        requiredClaims: [...REQUIRED_CLAIMS],
        clockTolerance: 0,
      });

      const expiresAt = payload.exp;
      if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) {
        throw new AuthError("AUTHORIZATION_INVALID");
      }

      return {
        userId: requireUserId(payload.sub),
        expiresAt,
      };
    } catch (error) {
      throw mapVerificationError(error);
    }
  };

  return {
    issuer,
    audiences,
    verifyAccessToken,
    verifyAuthorizationHeader: (header) => verifyAccessToken(parseBearerAuthorization(header)),
  };
}
