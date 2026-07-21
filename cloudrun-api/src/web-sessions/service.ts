import { randomUUID } from "node:crypto";

import {
  ViewerSchema,
  WebSessionCreatedSchema,
  WebSessionCurrentSchema,
  type WebSessionCreated,
  type WebSessionCurrent,
} from "@smart-job/api-contracts";
import { decodeJwt } from "jose";
import { z } from "zod";

import {
  AuthError,
  type SupabaseJwtVerifier,
  type SupabaseUserClient,
  type SupabaseWebAuthClient,
  type SupabaseWebAuthUser,
} from "../auth/index.js";
import type { WebSessionDatabaseRuntime } from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import { readViewerDatabaseData } from "../viewer/repository.js";
import type { WebSessionCrypto } from "./crypto.js";
import {
  insertWebSession,
  lockActiveWebSession,
  readActiveWebSession,
  revokeWebSession,
  updateWebSessionCredentials,
  type WebSessionRow,
} from "./repository.js";

const WEB_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const sessionClaimSchema = z.object({ session_id: z.uuid() }).passthrough();

interface ResolvedSession {
  readonly id: string;
  readonly userId: string;
  readonly accessToken: string;
  readonly absoluteExpiresAt: Date;
}

type ResolutionResult =
  | { readonly kind: "resolved"; readonly session: ResolvedSession }
  | { readonly kind: "invalid" };

interface ResolvedWebSession {
  readonly sessionTokenHash: Buffer;
  readonly session: ResolvedSession;
}

/** Safe domain-auth result; encrypted Supabase credentials never cross this boundary. */
export interface WebSessionAuthentication {
  readonly userId: string;
  readonly absoluteExpiresAt: Date;
}

export interface WebSessionService {
  createSession(email: string, password: string): Promise<WebSessionCreated>;
  authenticateSession(sessionToken: string): Promise<WebSessionAuthentication>;
  currentSession(sessionToken: string): Promise<WebSessionCurrent>;
  revokeSession(sessionToken: string, csrfToken: string): Promise<void>;
}

export interface CreateWebSessionServiceOptions {
  readonly database: WebSessionDatabaseRuntime;
  readonly jwtVerifier: SupabaseJwtVerifier;
  readonly supabaseUsers: SupabaseUserClient;
  readonly supabaseWebAuth: SupabaseWebAuthClient;
  readonly crypto: WebSessionCrypto;
  readonly now?: () => Date;
  readonly refreshWindowMs?: number;
}

function invalidSession(): AppError {
  return new AppError({
    statusCode: 401,
    code: "WEB_SESSION_INVALID",
    message: "The website session is invalid or expired.",
  });
}

function csrfInvalid(): AppError {
  return new AppError({
    statusCode: 403,
    code: "CSRF_INVALID",
    message: "The CSRF token is missing or invalid.",
  });
}

function emailNotVerified(): AppError {
  return new AppError({
    statusCode: 403,
    code: "EMAIL_NOT_VERIFIED",
    message: "Verify your email address before signing in.",
  });
}

function authUnavailable(cause?: unknown): AppError {
  return new AppError({
    statusCode: 503,
    code: "AUTH_SERVICE_UNAVAILABLE",
    message: "Authentication services are temporarily unavailable.",
    retryable: true,
    cause,
  });
}

async function verifyAccessToken(
  verifier: SupabaseJwtVerifier,
  accessToken: string,
): Promise<{ readonly userId: string; readonly expiresAt: number; readonly sessionId: string }> {
  let identity: Awaited<ReturnType<SupabaseJwtVerifier["verifyAccessToken"]>>;
  try {
    identity = await verifier.verifyAccessToken(accessToken);
  } catch (error) {
    if (error instanceof AuthError) throw error.toAppError();
    throw error;
  }

  let sessionId: string;
  try {
    sessionId = sessionClaimSchema.parse(decodeJwt(accessToken)).session_id.toLowerCase();
  } catch (error) {
    throw new AppError({
      statusCode: 401,
      code: "WEB_SESSION_INVALID",
      message: "The website session is invalid or expired.",
      cause: error,
    });
  }
  return { ...identity, sessionId };
}

function viewerFrom(
  authUser: SupabaseWebAuthUser | Awaited<ReturnType<SupabaseUserClient["getUser"]>>,
  databaseData: Awaited<ReturnType<typeof readViewerDatabaseData>>,
) {
  return ViewerSchema.parse({
    uid: authUser.userId,
    email: authUser.email,
    displayName: databaseData.displayName,
    emailVerified: authUser.emailVerified,
    workspaces: databaseData.workspaces,
  });
}

function binding(row: WebSessionRow) {
  return {
    id: row.id,
    userId: row.userId,
    supabaseSessionId: row.supabaseSessionId,
    absoluteExpiresAt: row.absoluteExpiresAt,
  };
}

export function createWebSessionService(
  options: CreateWebSessionServiceOptions,
): WebSessionService {
  const now = options.now ?? (() => new Date());
  const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  if (!Number.isSafeInteger(refreshWindowMs) || refreshWindowMs < 0 || refreshWindowMs > 300_000) {
    throw new TypeError("The web-session refresh window must be between 0 and 300000 ms");
  }

  async function bestEffortSignOut(accessToken: string): Promise<void> {
    await options.supabaseWebAuth.signOut(accessToken).catch(() => undefined);
  }

  async function invalidateResolvedSession(
    sessionTokenHash: Buffer,
    expectedSessionId: string,
    reason: "identity_mismatch" | "auth_invalid",
  ): Promise<void> {
    await options.database.withWebSessionTransaction(async (transaction) => {
      const locked = await lockActiveWebSession(transaction, sessionTokenHash, now());
      if (locked !== null && locked.id === expectedSessionId) {
        await revokeWebSession(transaction, locked.id, reason, now());
      }
    });
  }

  async function resolveWebSession(
    sessionToken: string,
  ): Promise<ResolvedWebSession> {
    const sessionTokenHash = options.crypto.hashToken(sessionToken);
    const currentTime = now();
    const unlocked = await options.database.withWebSessionTransaction(
      (transaction) => readActiveWebSession(transaction, sessionTokenHash, currentTime),
    );
    if (unlocked === null) throw invalidSession();
    if (unlocked.accessTokenExpiresAt.getTime() > currentTime.getTime() + refreshWindowMs) {
      const credentials = options.crypto.decrypt(binding(unlocked), unlocked.credentials);
      return {
        sessionTokenHash,
        session: {
          id: unlocked.id,
          userId: unlocked.userId,
          accessToken: credentials.accessToken,
          absoluteExpiresAt: unlocked.absoluteExpiresAt,
        },
      };
    }

    // Only sessions inside the refresh window take a write lock. Re-checking
    // under that lock makes concurrent refresh-token rotation single-flight.
    const resolution = await options.database.withWebSessionTransaction<ResolutionResult>(
      async (transaction) => {
        const lockedAt = now();
        const row = await lockActiveWebSession(transaction, sessionTokenHash, lockedAt);
        if (row === null) return { kind: "invalid" };
        let credentials = options.crypto.decrypt(binding(row), row.credentials);

        if (row.accessTokenExpiresAt.getTime() <= lockedAt.getTime() + refreshWindowMs) {
          let refreshed;
          try {
            refreshed = await options.supabaseWebAuth.refreshSession(credentials.refreshToken);
          } catch (error) {
            if (error instanceof AppError && error.statusCode === 401) {
              await revokeWebSession(transaction, row.id, "refresh_invalid", now());
              return { kind: "invalid" };
            }
            throw error;
          }

          let verified;
          try {
            verified = await verifyAccessToken(options.jwtVerifier, refreshed.accessToken);
          } catch (error) {
            if (error instanceof AppError && error.statusCode < 500) {
              await revokeWebSession(transaction, row.id, "refresh_invalid", now());
              return { kind: "invalid" };
            }
            throw error;
          }
          if (
            verified.userId !== row.userId
            || verified.sessionId !== row.supabaseSessionId
            || (refreshed.user !== null && refreshed.user.userId !== row.userId)
          ) {
            await revokeWebSession(transaction, row.id, "identity_mismatch", now());
            return { kind: "invalid" };
          }

          credentials = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
          };
          const encrypted = options.crypto.encrypt(binding(row), credentials);
          await updateWebSessionCredentials(
            transaction,
            row.id,
            encrypted,
            new Date(verified.expiresAt * 1_000),
            now(),
          );
        }

        return {
          kind: "resolved",
          session: {
            id: row.id,
            userId: row.userId,
            accessToken: credentials.accessToken,
            absoluteExpiresAt: row.absoluteExpiresAt,
          },
        };
      },
    );
    if (resolution.kind === "invalid") throw invalidSession();

    return { sessionTokenHash, session: resolution.session };
  }

  async function loadVerifiedAuthUser(
    resolved: ResolvedWebSession,
  ): Promise<Awaited<ReturnType<SupabaseUserClient["getUser"]>>> {
    let authUser: Awaited<ReturnType<SupabaseUserClient["getUser"]>>;
    try {
      authUser = await options.supabaseUsers.getUser(resolved.session.accessToken);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) {
        await invalidateResolvedSession(
          resolved.sessionTokenHash,
          resolved.session.id,
          "auth_invalid",
        );
        throw invalidSession();
      }
      throw error;
    }
    if (authUser.userId !== resolved.session.userId) {
      await invalidateResolvedSession(
        resolved.sessionTokenHash,
        resolved.session.id,
        "identity_mismatch",
      );
      throw invalidSession();
    }
    if (!authUser.emailVerified) {
      await invalidateResolvedSession(
        resolved.sessionTokenHash,
        resolved.session.id,
        "auth_invalid",
      );
      throw emailNotVerified();
    }

    return authUser;
  }

  return {
    async createSession(email, password) {
      const authSession = await options.supabaseWebAuth.signInWithPassword(email, password);
      const authUser = authSession.user;
      if (authUser === null) {
        await bestEffortSignOut(authSession.accessToken);
        throw authUnavailable();
      }
      if (!authUser.emailVerified) {
        await bestEffortSignOut(authSession.accessToken);
        throw emailNotVerified();
      }

      let verified: Awaited<ReturnType<typeof verifyAccessToken>>;
      try {
        verified = await verifyAccessToken(options.jwtVerifier, authSession.accessToken);
      } catch (error) {
        await bestEffortSignOut(authSession.accessToken);
        if (error instanceof AppError && error.statusCode < 500) {
          throw authUnavailable(error);
        }
        throw error;
      }
      if (verified.userId !== authUser.userId || verified.expiresAt * 1_000 <= now().getTime()) {
        await bestEffortSignOut(authSession.accessToken);
        throw authUnavailable();
      }

      const createdAt = now();
      const absoluteExpiresAt = new Date(createdAt.getTime() + WEB_SESSION_LIFETIME_MS);
      const id = randomUUID();
      const sessionToken = options.crypto.generateSessionToken();
      const csrfToken = options.crypto.generateCsrfToken();
      const encryptionBinding = {
        id,
        userId: verified.userId,
        supabaseSessionId: verified.sessionId,
        absoluteExpiresAt,
      };
      let databaseData: Awaited<ReturnType<typeof readViewerDatabaseData>>;
      try {
        const encrypted = options.crypto.encrypt(encryptionBinding, {
          accessToken: authSession.accessToken,
          refreshToken: authSession.refreshToken,
        });
        databaseData = await options.database.withTransaction(
          { userId: verified.userId },
          async (transaction) => {
            await insertWebSession(transaction, {
              ...encryptionBinding,
              sessionTokenHash: options.crypto.hashToken(sessionToken),
              csrfTokenHash: options.crypto.hashToken(csrfToken),
              credentials: encrypted,
              accessTokenExpiresAt: new Date(verified.expiresAt * 1_000),
              createdAt,
            });
            return readViewerDatabaseData(transaction, verified.userId);
          },
        );
      } catch (error) {
        await bestEffortSignOut(authSession.accessToken);
        throw error;
      }

      return WebSessionCreatedSchema.parse({
        sessionToken,
        csrfToken,
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        viewer: viewerFrom(authUser, databaseData),
      });
    },

    async authenticateSession(sessionToken) {
      const { session } = await resolveWebSession(sessionToken);
      return {
        userId: session.userId,
        absoluteExpiresAt: new Date(session.absoluteExpiresAt),
      };
    },

    async currentSession(sessionToken) {
      const resolved = await resolveWebSession(sessionToken);
      const authUser = await loadVerifiedAuthUser(resolved);
      const { session } = resolved;
      const databaseData = await options.database.withTransaction(
        { userId: session.userId },
        (transaction) => readViewerDatabaseData(transaction, session.userId),
      );
      return WebSessionCurrentSchema.parse({
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        viewer: viewerFrom(authUser, databaseData),
      });
    },

    async revokeSession(sessionToken, csrfToken) {
      const sessionTokenHash = options.crypto.hashToken(sessionToken);
      const csrfTokenHash = options.crypto.hashToken(csrfToken);
      const result = await options.database.withWebSessionTransaction(
        async (transaction): Promise<
          | { readonly kind: "invalid" }
          | { readonly kind: "csrf-invalid" }
          | { readonly kind: "revoked"; readonly accessToken: string | null }
        > => {
          const row = await lockActiveWebSession(transaction, sessionTokenHash, now());
          if (row === null) return { kind: "invalid" };
          if (!options.crypto.hashesEqual(row.csrfTokenHash, csrfTokenHash)) {
            return { kind: "csrf-invalid" };
          }

          let accessToken: string | null = null;
          try {
            accessToken = options.crypto.decrypt(binding(row), row.credentials).accessToken;
          } catch {
            // Local revocation must still succeed after a key/configuration incident.
          }
          await revokeWebSession(transaction, row.id, "user_logout", now());
          return { kind: "revoked", accessToken };
        },
      );
      if (result.kind === "invalid") throw invalidSession();
      if (result.kind === "csrf-invalid") throw csrfInvalid();
      if (result.accessToken !== null) await bestEffortSignOut(result.accessToken);
    },
  };
}
