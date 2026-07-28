import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";

import { TaxGatewayError } from "./errors.js";

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

const googleServiceClaimsSchema = z.object({
  sub: z.string().regex(/^\d{6,32}$/),
  email: z.email().transform((value) => value.toLowerCase()),
  email_verified: z.literal(true),
}).passthrough();

export interface ServiceIdentity {
  readonly subject: string;
  readonly email: string;
}

export interface ServiceIdentityVerifier {
  verifyAuthorizationHeader(header: string | string[] | undefined): Promise<ServiceIdentity>;
}

export interface CreateServiceIdentityVerifierOptions {
  readonly audience: string;
  readonly allowedServiceAccounts: readonly string[];
  readonly keyResolver?: JWTVerifyGetKey;
}

function identityTokenContextSubject(subject: string): string {
  const bytes = createHash("sha256").update(`smart-job-google-service:${subject}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes.toString("hex");
}

export function serviceIdentitySubjectHash(subject: string): string {
  return identityTokenContextSubject(subject);
}

export function createServiceIdentityVerifier(
  options: CreateServiceIdentityVerifierOptions,
): ServiceIdentityVerifier {
  const allowed = new Set(options.allowedServiceAccounts.map((value) => value.trim().toLowerCase()));
  if (allowed.size === 0 || [...allowed].some((email) => !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email))) {
    throw new TypeError("At least one valid Google service-account email is required");
  }
  const keyResolver = options.keyResolver ?? createRemoteJWKSet(GOOGLE_JWKS_URL, {
    timeoutDuration: 3_000,
    cooldownDuration: 30_000,
  });

  return {
    async verifyAuthorizationHeader(header): Promise<ServiceIdentity> {
      const raw = Array.isArray(header) ? header[0] : header;
      if (
        raw === undefined
        || raw.length > 16_384
        || raw.includes(",")
        || !/^Bearer [A-Za-z0-9._~-]+$/.test(raw)
      ) {
        throw new TaxGatewayError(401, "INTERNAL_IDENTITY_INVALID", "A valid internal service identity is required.", false);
      }
      try {
        const verified = await jwtVerify(raw.slice("Bearer ".length), keyResolver, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: options.audience,
          algorithms: ["RS256"],
          clockTolerance: 5,
          maxTokenAge: "1h",
        });
        const claims = googleServiceClaimsSchema.parse(verified.payload);
        if (!allowed.has(claims.email)) {
          throw new TaxGatewayError(401, "INTERNAL_IDENTITY_INVALID", "A valid internal service identity is required.", false);
        }
        return { subject: claims.sub, email: claims.email };
      } catch (error) {
        if (error instanceof TaxGatewayError) throw error;
        throw new TaxGatewayError(401, "INTERNAL_IDENTITY_INVALID", "A valid internal service identity is required.", false);
      }
    },
  };
}
