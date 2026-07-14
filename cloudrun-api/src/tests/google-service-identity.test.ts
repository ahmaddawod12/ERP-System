import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { SignJWT } from "jose";

import {
  createGoogleServiceIdentityVerifier,
  serviceIdentityContextUserId,
} from "../auth/google-service-identity.js";
import { AppError } from "../http/errors.js";

const audience = "https://smart-job-api-abc.run.app";
const allowedEmail = "document-dispatch@smart-job-prod.iam.gserviceaccount.com";
const subject = "123456789012345678901";

async function token(input: {
  readonly audience?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly issuer?: string;
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = await new SignJWT({
    email: input.email ?? allowedEmail,
    email_verified: input.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(input.issuer ?? "https://accounts.google.com")
    .setAudience(input.audience ?? audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { jwt, publicKey };
}

test("Google service identity verifies signature, issuer, audience, and allowlist", async () => {
  const signed = await token();
  const verifier = createGoogleServiceIdentityVerifier({
    audience,
    allowedServiceAccounts: [allowedEmail.toUpperCase()],
    keyResolver: async () => signed.publicKey,
  });
  const identity = await verifier.verifyAuthorizationHeader(`Bearer ${signed.jwt}`);
  assert.deepEqual(identity, {
    subject,
    email: allowedEmail,
    contextUserId: serviceIdentityContextUserId(subject),
  });
  assert.equal(identity.contextUserId, serviceIdentityContextUserId(subject));
  assert.match(identity.contextUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("Google service identity fails closed for wrong audience, caller, or header shape", async () => {
  for (const signed of [
    await token({ audience: "https://other.run.app" }),
    await token({ email: "other@smart-job-prod.iam.gserviceaccount.com" }),
    await token({ emailVerified: false }),
    await token({ issuer: "https://issuer.invalid" }),
  ]) {
    const verifier = createGoogleServiceIdentityVerifier({
      audience,
      allowedServiceAccounts: [allowedEmail],
      keyResolver: async () => signed.publicKey,
    });
    await assert.rejects(
      verifier.verifyAuthorizationHeader(`Bearer ${signed.jwt}`),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 401
        && error.code === "INTERNAL_IDENTITY_INVALID",
    );
  }

  const valid = await token();
  const verifier = createGoogleServiceIdentityVerifier({
    audience,
    allowedServiceAccounts: [allowedEmail],
    keyResolver: async () => valid.publicKey,
  });
  for (const header of [undefined, "", `bearer ${valid.jwt}`, `Bearer ${valid.jwt}, Bearer ${valid.jwt}`]) {
    await assert.rejects(
      verifier.verifyAuthorizationHeader(header),
      (error: unknown) => error instanceof AppError && error.statusCode === 401,
    );
  }
});
