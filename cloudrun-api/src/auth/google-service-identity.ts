import { createHash, timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";

import { AppError } from "../http/errors.js";

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const googleServiceClaimsSchema = z.object({
  sub: z.string().regex(/^\d{6,32}$/),
  email: z.email().transform((value) => value.toLowerCase()),
  email_verified: z.literal(true),
}).passthrough();

export interface GoogleServiceIdentity {
  readonly subject: string;
  readonly email: string;
  readonly contextUserId: string;
}

export interface GoogleServiceIdentityVerifier {
  verifyAuthorizationHeader(header: string | undefined): Promise<GoogleServiceIdentity>;
}

export interface CreateGoogleServiceIdentityVerifierOptions {
  readonly audience: string;
  readonly allowedServiceAccounts: readonly string[];
  readonly keyResolver?: JWTVerifyGetKey;
}

export interface CreateLocalServiceIdentityVerifierOptions {
  readonly token: string;
  readonly email?: string;
}

function invalidInternalIdentity(cause?: unknown): AppError {
  return new AppError({
    statusCode: 401,
    code: "INTERNAL_IDENTITY_INVALID",
    message: "A valid internal service identity is required.",
    cause,
  });
}

export function serviceIdentityContextUserId(subject: string): string {
  const bytes = createHash("sha256").update(`smart-job-google-service:${subject}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createGoogleServiceIdentityVerifier(
  options: CreateGoogleServiceIdentityVerifierOptions,
): GoogleServiceIdentityVerifier {
  const allowed = new Set(options.allowedServiceAccounts.map((value) => value.trim().toLowerCase()));
  if (allowed.size === 0 || [...allowed].some((email) => !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email))) {
    throw new TypeError("At least one valid Google service-account email is required");
  }
  const keyResolver = options.keyResolver ?? createRemoteJWKSet(GOOGLE_JWKS_URL, {
    timeoutDuration: 3_000,
    cooldownDuration: 30_000,
  });

  return {
    async verifyAuthorizationHeader(header): Promise<GoogleServiceIdentity> {
      if (
        header === undefined
        || header.length > 16_384
        || header.includes(",")
        || !/^Bearer [A-Za-z0-9._~-]+$/.test(header)
      ) {
        throw invalidInternalIdentity();
      }
      try {
        const verified = await jwtVerify(header.slice("Bearer ".length), keyResolver, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: options.audience,
          algorithms: ["RS256"],
          clockTolerance: 5,
          maxTokenAge: "1h",
        });
        const claims = googleServiceClaimsSchema.parse(verified.payload);
        if (!allowed.has(claims.email)) throw invalidInternalIdentity();
        return {
          subject: claims.sub,
          email: claims.email,
          contextUserId: serviceIdentityContextUserId(claims.sub),
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw invalidInternalIdentity(error);
      }
    },
  };
}

export function createLocalServiceIdentityVerifier(
  options: CreateLocalServiceIdentityVerifierOptions,
): GoogleServiceIdentityVerifier {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(options.token)) {
    throw new TypeError("The local identity token is invalid");
  }
  const expected = Buffer.from(options.token);
  const email = (options.email ?? "local-platform@smart-job-local.iam.gserviceaccount.com")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email)) {
    throw new TypeError("The local identity email is invalid");
  }
  const subject = "100000000000000000001";
  return {
    async verifyAuthorizationHeader(header): Promise<GoogleServiceIdentity> {
      const prefix = "Bearer ";
      const supplied = header?.startsWith(prefix)
        ? Buffer.from(header.slice(prefix.length))
        : Buffer.alloc(0);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw invalidInternalIdentity();
      }
      return {
        subject,
        email,
        contextUserId: serviceIdentityContextUserId(subject),
      };
    },
  };
}
