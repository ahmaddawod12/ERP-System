import { AuthError } from "./errors.js";

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_HEADER_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const SMART_JOB_SESSION_HEADER_PATTERN = /^SmartJobSession ([A-Za-z0-9_-]{43})$/i;

export type AuthorizationHeader = string | readonly string[] | undefined;

export type AuthorizationCredential =
  | { readonly scheme: "bearer"; readonly token: string }
  | { readonly scheme: "smart-job-session"; readonly token: string };

export function isCompactJwt(value: string): boolean {
  return COMPACT_JWT_PATTERN.test(value);
}

/**
 * Parses exactly one supported credential. Both accepted schemes intentionally
 * use a single strict space and reject duplicate/comma-joined headers, so a
 * request can never be interpreted as both mobile and website authentication.
 */
export function parseAuthorizationCredential(
  header: AuthorizationHeader,
): AuthorizationCredential {
  if (header === undefined) {
    throw new AuthError("AUTHORIZATION_REQUIRED");
  }

  if (typeof header !== "string") {
    throw new AuthError("AUTHORIZATION_INVALID");
  }

  const bearerMatch = BEARER_HEADER_PATTERN.exec(header);
  const bearerToken = bearerMatch?.[1];
  if (bearerToken !== undefined) {
    return { scheme: "bearer", token: bearerToken };
  }

  const webSessionMatch = SMART_JOB_SESSION_HEADER_PATTERN.exec(header);
  const webSessionToken = webSessionMatch?.[1];
  if (webSessionToken !== undefined) {
    return { scheme: "smart-job-session", token: webSessionToken };
  }

  throw new AuthError("AUTHORIZATION_INVALID");
}

/**
 * Parses exactly one RFC 6750 bearer credential. Authentication schemes are
 * case-insensitive, while extra whitespace, comma-joined credentials, and
 * non-compact-JWT values are rejected.
 */
export function parseBearerAuthorization(header: AuthorizationHeader): string {
  const credential = parseAuthorizationCredential(header);
  if (credential.scheme !== "bearer") {
    throw new AuthError("AUTHORIZATION_INVALID");
  }
  return credential.token;
}
