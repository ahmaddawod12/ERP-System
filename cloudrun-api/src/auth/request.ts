import type { FastifyRequest } from "fastify";

import type { WebSessionService } from "../web-sessions/service.js";
import {
  parseAuthorizationCredential,
  parseBearerAuthorization,
} from "./authorization.js";
import { AuthError } from "./errors.js";
import type { AuthenticatedUser, SupabaseJwtVerifier } from "./supabase-jwt.js";

export interface AuthenticatedBearerRequest {
  readonly accessToken: string;
  readonly identity: AuthenticatedUser;
}

export type AuthenticatedApiRequest =
  | {
      readonly scheme: "bearer";
      readonly userId: string;
      readonly expiresAt: number;
      readonly accessToken: string;
    }
  | {
      readonly scheme: "smart-job-session";
      readonly userId: string;
      readonly absoluteExpiresAt: Date;
      readonly sessionToken: string;
    };

export interface ApiRequestAuthenticator {
  authenticate(request: FastifyRequest): Promise<AuthenticatedApiRequest>;
}

export interface CreateApiRequestAuthenticatorOptions {
  readonly jwtVerifier: SupabaseJwtVerifier;
  readonly webSessions: Pick<WebSessionService, "authenticateSession">;
}

export async function authenticateBearerRequest(
  request: FastifyRequest,
  verifier: SupabaseJwtVerifier,
): Promise<AuthenticatedBearerRequest> {
  try {
    const accessToken = parseBearerAuthorization(request.headers.authorization);
    const identity = await verifier.verifyAccessToken(accessToken);
    return { accessToken, identity };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error.toAppError();
    }
    throw error;
  }
}

export function createApiRequestAuthenticator(
  options: CreateApiRequestAuthenticatorOptions,
): ApiRequestAuthenticator {
  return {
    async authenticate(request) {
      let credential;
      try {
        credential = parseAuthorizationCredential(request.headers.authorization);
      } catch (error) {
        if (error instanceof AuthError) throw error.toAppError();
        throw error;
      }

      if (credential.scheme === "bearer") {
        let identity: AuthenticatedUser;
        try {
          identity = await options.jwtVerifier.verifyAccessToken(credential.token);
        } catch (error) {
          if (error instanceof AuthError) throw error.toAppError();
          throw error;
        }
        return {
          scheme: "bearer",
          userId: identity.userId,
          expiresAt: identity.expiresAt,
          accessToken: credential.token,
        };
      }

      const session = await options.webSessions.authenticateSession(credential.token);
      return {
        scheme: "smart-job-session",
        userId: session.userId,
        absoluteExpiresAt: new Date(session.absoluteExpiresAt),
        sessionToken: credential.token,
      };
    },
  };
}
