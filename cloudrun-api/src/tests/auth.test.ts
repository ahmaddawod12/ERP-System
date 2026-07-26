import assert from "node:assert/strict";
import test from "node:test";

import {
  SignJWT,
  createLocalJWKSet,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
} from "jose";
import type { FastifyRequest } from "fastify";

import {
  parseAuthorizationCredential,
  parseBearerAuthorization,
} from "../auth/authorization.js";
import { AuthError, authErrorToAppError, type AuthErrorCode } from "../auth/errors.js";
import { createApiRequestAuthenticator } from "../auth/request.js";
import {
  createSupabaseJwtVerifier,
  type AuthenticatedUser,
  type SupabaseJwtVerifier,
} from "../auth/supabase-jwt.js";

const ISSUER = "https://smart-job-test.supabase.co/auth/v1";
const USER_ID = "92C47EF6-0B19-4C8C-A710-14A5DF874749";
const NORMALIZED_USER_ID = USER_ID.toLowerCase();
const AUDIENCE = "authenticated";
const NOW = Math.floor(Date.now() / 1_000);

const es256Keys = await generateKeyPair("ES256", { extractable: true });
const es256PublicJwk = await exportJWK(es256Keys.publicKey);
es256PublicJwk.alg = "ES256";
es256PublicJwk.kid = "test-es256";
es256PublicJwk.use = "sig";

const staticEs256Jwks = createLocalJWKSet({ keys: [es256PublicJwk] });
const verifier = createSupabaseJwtVerifier({
  issuer: ISSUER,
  audiences: AUDIENCE,
  jwks: staticEs256Jwks,
});

interface AccessTokenOptions {
  readonly issuer?: string;
  readonly audience?: string | string[];
  readonly subject?: string;
  readonly expiration?: number | null;
  readonly type?: string | null;
}

async function signEs256AccessToken(options: AccessTokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({
    role: "dev",
    companyId: "forged-public-company-id",
    user_id: "not-the-verified-subject",
    user_metadata: { role: "manager", companyId: "forged-company-id" },
  })
    .setProtectedHeader({
      alg: "ES256",
      kid: "test-es256",
      ...(options.type === null ? {} : { typ: options.type ?? "JWT" }),
    })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject(options.subject ?? USER_ID)
    .setIssuedAt(NOW);

  if (options.expiration !== null) {
    jwt.setExpirationTime(options.expiration ?? NOW + 600);
  }

  return jwt.sign(es256Keys.privateKey);
}

async function expectAuthError(
  promise: Promise<unknown>,
  code: AuthErrorCode,
): Promise<AuthError> {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, code);
    return error;
  }
}

test("strict Bearer parsing accepts one compact JWT and rejects ambiguous credentials", async () => {
  const token = await signEs256AccessToken();
  assert.equal(parseBearerAuthorization(`Bearer ${token}`), token);
  assert.equal(parseBearerAuthorization(`bEaReR ${token}`), token);

  assert.throws(
    () => parseBearerAuthorization(undefined),
    (error) => error instanceof AuthError && error.code === "AUTHORIZATION_REQUIRED",
  );

  const invalidHeaders = [
    ["Bearer first.token.value", "Bearer second.token.value"],
    "",
    "Basic abc.def.ghi",
    "Bearer  abc.def.ghi",
    "Bearer\tabc.def.ghi",
    "Bearer abc.def.ghi ",
    "Bearer abc.def.ghi, Bearer def.ghi.jkl",
    "Bearer abc.def",
    "Bearer abc.def.ghi.extra",
  ] as const;

  for (const header of invalidHeaders) {
    assert.throws(
      () => parseBearerAuthorization(header),
      (error) => error instanceof AuthError && error.code === "AUTHORIZATION_INVALID",
    );
  }
});

test("strict API authorization parsing accepts exactly one Bearer or opaque session", async () => {
  const bearerToken = await signEs256AccessToken();
  const sessionToken = "S".repeat(43);
  assert.deepEqual(parseAuthorizationCredential(`Bearer ${bearerToken}`), {
    scheme: "bearer",
    token: bearerToken,
  });
  assert.deepEqual(parseAuthorizationCredential(`sMaRtJoBsEsSiOn ${sessionToken}`), {
    scheme: "smart-job-session",
    token: sessionToken,
  });

  for (const header of [
    `Bearer ${bearerToken}, SmartJobSession ${sessionToken}`,
    `SmartJobSession ${sessionToken}, Bearer ${bearerToken}`,
    `SmartJobSession  ${sessionToken}`,
    `SmartJobSession\t${sessionToken}`,
    `SmartJobSession ${sessionToken} `,
    `SmartJobSession ${"S".repeat(42)}`,
    [`Bearer ${bearerToken}`, `SmartJobSession ${sessionToken}`],
  ] as const) {
    assert.throws(
      () => parseAuthorizationCredential(header),
      (error) => error instanceof AuthError && error.code === "AUTHORIZATION_INVALID",
    );
  }
  assert.throws(
    () => parseBearerAuthorization(`SmartJobSession ${sessionToken}`),
    (error) => error instanceof AuthError && error.code === "AUTHORIZATION_INVALID",
  );
});

test("unified request authentication preserves Bearer verification and hides Supabase tokens for opaque sessions", async () => {
  const bearerToken = await signEs256AccessToken();
  const sessionToken = "O".repeat(43);
  const absoluteExpiresAt = new Date("2026-07-14T00:00:00.000Z");
  let opaqueCalls = 0;
  const authenticator = createApiRequestAuthenticator({
    jwtVerifier: verifier,
    webSessions: {
      async authenticateSession(token) {
        opaqueCalls += 1;
        assert.equal(token, sessionToken);
        return { userId: NORMALIZED_USER_ID, absoluteExpiresAt };
      },
    },
  });
  const request = (authorization: string): FastifyRequest => ({
    headers: { authorization },
  }) as FastifyRequest;

  const bearer = await authenticator.authenticate(request(`Bearer ${bearerToken}`));
  assert.deepEqual(bearer, {
    scheme: "bearer",
    userId: NORMALIZED_USER_ID,
    expiresAt: NOW + 600,
    accessToken: bearerToken,
  });
  assert.equal(opaqueCalls, 0);

  const opaque = await authenticator.authenticate(
    request(`SmartJobSession ${sessionToken}`),
  );
  assert.deepEqual(opaque, {
    scheme: "smart-job-session",
    userId: NORMALIZED_USER_ID,
    absoluteExpiresAt,
    sessionToken,
  });
  assert.equal(opaqueCalls, 1);
  assert.equal(Reflect.has(opaque, "accessToken"), false);
  assert.equal(Reflect.has(opaque, "refreshToken"), false);
});

test("verified identity only exposes the signed UUID subject and expiry", async () => {
  const token = await signEs256AccessToken();
  const identity = await verifier.verifyAuthorizationHeader(`Bearer ${token}`);

  assert.deepEqual(identity, {
    userId: NORMALIZED_USER_ID,
    expiresAt: NOW + 600,
  });
  assert.deepEqual(Object.keys(identity).sort(), ["expiresAt", "userId"]);
  assert.equal(Reflect.has(identity, "role"), false);
  assert.equal(Reflect.has(identity, "companyId"), false);
  assert.equal(Reflect.has(identity, "user_metadata"), false);
});

test("issuer and configured audiences are matched exactly", async () => {
  const alternateAudienceVerifier = createSupabaseJwtVerifier({
    issuer: ISSUER,
    audiences: [AUDIENCE, "smart-job-mobile"],
    jwks: staticEs256Jwks,
  });
  const accepted = await alternateAudienceVerifier.verifyAccessToken(
    await signEs256AccessToken({ audience: "smart-job-mobile" }),
  );
  assert.equal(accepted.userId, NORMALIZED_USER_ID);
  assert.equal(Object.isFrozen(alternateAudienceVerifier.audiences), true);

  await expectAuthError(
    verifier.verifyAccessToken(
      await signEs256AccessToken({ issuer: "https://other.supabase.co/auth/v1" }),
    ),
    "AUTHORIZATION_INVALID",
  );
  await expectAuthError(
    verifier.verifyAccessToken(await signEs256AccessToken({ audience: "anonymous" })),
    "AUTHORIZATION_INVALID",
  );
});

test("expiry and a canonical non-nil UUID subject are mandatory", async () => {
  await expectAuthError(
    verifier.verifyAccessToken(await signEs256AccessToken({ expiration: null })),
    "AUTHORIZATION_INVALID",
  );
  await expectAuthError(
    verifier.verifyAccessToken(await signEs256AccessToken({ expiration: NOW - 1 })),
    "ACCESS_TOKEN_EXPIRED",
  );

  for (const subject of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
    await expectAuthError(
      verifier.verifyAccessToken(await signEs256AccessToken({ subject })),
      "AUTHORIZATION_INVALID",
    );
  }
});

test("only Supabase-supported asymmetric ES256 and RS256 signatures are accepted", async () => {
  const hs256Secret = new TextEncoder().encode("test-secret-that-must-never-be-used-for-supabase-jwks");
  const hs256Token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(USER_ID)
    .setExpirationTime(NOW + 600)
    .sign(hs256Secret);
  const hs256Verifier = createSupabaseJwtVerifier({
    issuer: ISSUER,
    audiences: AUDIENCE,
    jwks: async () => hs256Secret,
  });
  await expectAuthError(hs256Verifier.verifyAccessToken(hs256Token), "AUTHORIZATION_INVALID");

  const rs256Keys = await generateKeyPair("RS256", { extractable: true });
  const rs256PublicJwk = await exportJWK(rs256Keys.publicKey);
  rs256PublicJwk.alg = "RS256";
  rs256PublicJwk.kid = "test-rs256";
  rs256PublicJwk.use = "sig";
  const rs256Verifier = createSupabaseJwtVerifier({
    issuer: ISSUER,
    audiences: AUDIENCE,
    jwks: createLocalJWKSet({ keys: [rs256PublicJwk] }),
  });
  const rs256Token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-rs256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(USER_ID)
    .setExpirationTime(NOW + 600)
    .sign(rs256Keys.privateKey);
  assert.equal((await rs256Verifier.verifyAccessToken(rs256Token)).userId, NORMALIZED_USER_ID);
});

test("bad signatures and JWT types fail without retaining token contents", async () => {
  const wrongKeys = await generateKeyPair("ES256");
  const token = await new SignJWT({ marker: "token-leak-marker" })
    .setProtectedHeader({ alg: "ES256", kid: "test-es256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(USER_ID)
    .setExpirationTime(NOW + 600)
    .sign(wrongKeys.privateKey);
  const signatureError = await expectAuthError(
    verifier.verifyAccessToken(token),
    "AUTHORIZATION_INVALID",
  );
  assert.doesNotMatch(signatureError.message, /token-leak-marker/);
  assert.equal(signatureError.cause, undefined);

  await expectAuthError(
    verifier.verifyAccessToken(await signEs256AccessToken({ type: null })),
    "AUTHORIZATION_INVALID",
  );
});

test("JWKS outages map to a safe retryable AppError", async () => {
  const token = await signEs256AccessToken();
  const unavailableVerifier = createSupabaseJwtVerifier({
    issuer: ISSUER,
    audiences: AUDIENCE,
    jwks: async () => {
      throw new joseErrors.JWKSTimeout("secret upstream diagnostics");
    },
  });
  const authError = await expectAuthError(
    unavailableVerifier.verifyAccessToken(token),
    "AUTH_VERIFICATION_UNAVAILABLE",
  );
  const appError = authErrorToAppError(authError);

  assert.deepEqual(appError.toApiError(), {
    code: "AUTH_VERIFICATION_UNAVAILABLE",
    message: "Authentication verification is temporarily unavailable.",
    retryable: true,
  });
  assert.equal(appError.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(appError.toApiError()), /secret|diagnostic/i);
});

test("auth configuration permits local Supabase but rejects unsafe remote issuers", () => {
  const localVerifier: SupabaseJwtVerifier = createSupabaseJwtVerifier({
    issuer: "http://127.0.0.1:55321/auth/v1",
    audiences: AUDIENCE,
    jwks: staticEs256Jwks,
  });
  assert.equal(localVerifier.issuer, "http://127.0.0.1:55321/auth/v1");

  const containerRoutableVerifier = createSupabaseJwtVerifier({
    issuer: "http://127.0.0.1:55321/auth/v1",
    audiences: AUDIENCE,
    jwksUrl: new URL(
      "http://smart-job-supabase-gateway:8000/auth/v1/.well-known/jwks.json",
    ),
    jwks: staticEs256Jwks,
  });
  assert.equal(containerRoutableVerifier.issuer, "http://127.0.0.1:55321/auth/v1");
  assert.throws(() => createSupabaseJwtVerifier({
    issuer: ISSUER,
    audiences: AUDIENCE,
    jwksUrl: new URL("http://untrusted.example.test/auth/v1/.well-known/jwks.json"),
    jwks: staticEs256Jwks,
  }), /JWKS URL/);

  const invalidOptions = [
    { issuer: "http://example.com/auth/v1", audiences: AUDIENCE },
    { issuer: "https://example.com/not-auth", audiences: AUDIENCE },
    { issuer: `${ISSUER}?query=unsafe`, audiences: AUDIENCE },
    { issuer: ISSUER, audiences: [] },
    { issuer: ISSUER, audiences: [" authenticated"] },
  ] as const;

  for (const options of invalidOptions) {
    assert.throws(() => createSupabaseJwtVerifier({ ...options, jwks: staticEs256Jwks }), TypeError);
  }
});

test("direct access-token verification rejects malformed values safely", async () => {
  const marker = "not-a-jwt-token-leak-marker";
  const error = await expectAuthError(
    verifier.verifyAccessToken(marker),
    "AUTHORIZATION_INVALID",
  );
  assert.doesNotMatch(error.message, new RegExp(marker));

  const publicShape: AuthenticatedUser = {
    userId: NORMALIZED_USER_ID,
    expiresAt: NOW + 600,
  };
  assert.equal(publicShape.userId, NORMALIZED_USER_ID);
});
