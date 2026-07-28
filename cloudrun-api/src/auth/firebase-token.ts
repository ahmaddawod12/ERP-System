import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import {
  getAuth,
  type Auth,
  type DecodedIdToken,
} from "firebase-admin/auth";
import { createHash } from "node:crypto";

import {
  isCompactJwt,
  parseBearerAuthorization,
  type AuthorizationHeader,
} from "./authorization.js";
import { AuthError } from "./errors.js";

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export interface AuthenticatedUser {
  readonly userId: string;
  readonly providerUserId?: string;
  readonly expiresAt: number;
  readonly authenticatedAt?: number;
}

export interface FirebaseTokenVerifier {
  readonly projectId?: string;
  readonly issuer?: string;
  readonly audiences?: readonly string[];
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
  verifyAuthorizationHeader(header: AuthorizationHeader): Promise<AuthenticatedUser>;
}

export interface FirebaseTokenVerifierOptions {
  readonly projectId: string;
  readonly auth?: Pick<Auth, "verifyIdToken">;
}

function requireProjectId(value: string): string {
  const projectId = value.trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new TypeError("FIREBASE_PROJECT_ID must be a valid Google Cloud project ID");
  }
  return projectId;
}

function firebaseApp(projectId: string): App {
  const existing = getApps().find((candidate) => candidate.name === "smart-job-auth");
  return existing ?? initializeApp(
    { credential: applicationDefault(), projectId },
    "smart-job-auth",
  );
}

function requireFirebaseUid(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new AuthError("AUTHORIZATION_INVALID");
  }
  return value;
}

function internalUserId(firebaseUid: string): string {
  const bytes = createHash("sha256")
    .update("smart-job:firebase-auth:v1\0", "utf8")
    .update(firebaseUid, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AuthError("AUTHORIZATION_INVALID");
  }
  return value;
}

function mapVerificationError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code === "auth/id-token-expired") return new AuthError("ACCESS_TOKEN_EXPIRED");
  if (
    code === "auth/argument-error"
    || code === "auth/id-token-revoked"
    || code === "auth/user-disabled"
  ) {
    return new AuthError("AUTHORIZATION_INVALID");
  }
  if (code.startsWith("auth/")) return new AuthError("AUTHORIZATION_INVALID");
  return new AuthError("AUTH_VERIFICATION_UNAVAILABLE");
}

export function createFirebaseTokenVerifier(
  options: FirebaseTokenVerifierOptions,
): FirebaseTokenVerifier {
  const projectId = requireProjectId(options.projectId);
  const auth = options.auth ?? getAuth(firebaseApp(projectId));

  const verifyAccessToken = async (token: string): Promise<AuthenticatedUser> => {
    if (!isCompactJwt(token)) throw new AuthError("AUTHORIZATION_INVALID");
    let decoded: DecodedIdToken;
    try {
      decoded = await auth.verifyIdToken(token, false);
    } catch (error) {
      throw mapVerificationError(error);
    }
    if (decoded.aud !== projectId || decoded.iss !== `https://securetoken.google.com/${projectId}`) {
      throw new AuthError("AUTHORIZATION_INVALID");
    }
    const providerUserId = requireFirebaseUid(decoded.uid);
    return {
      userId: internalUserId(providerUserId),
      providerUserId,
      expiresAt: requirePositiveInteger(decoded.exp),
      authenticatedAt: requirePositiveInteger(decoded.auth_time),
    };
  };

  return {
    projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
    verifyAccessToken,
    verifyAuthorizationHeader: (header) =>
      verifyAccessToken(parseBearerAuthorization(header)),
  };
}
