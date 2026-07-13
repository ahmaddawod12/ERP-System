import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createContactChallenge, verifyContactChallenge } from "../src/lib/contact/challenge.ts";

const TEST_SECRET = "test-contact-challenge-secret-32-bytes!!";

before(() => {
  process.env.WEBSITE_SESSION_SECRET = TEST_SECRET;
});

test("createContactChallenge returns a question and a token", async () => {
  const challenge = await createContactChallenge();
  assert.equal(challenge.question, "3 + 4");
  assert.ok(typeof challenge.token === "string");
  assert.ok(challenge.token.length > 0);
});

test("verifyContactChallenge accepts the correct answer", async () => {
  const { token } = await createContactChallenge();
  const valid = await verifyContactChallenge(token, "7");
  assert.equal(valid, true);
});

test("verifyContactChallenge rejects the wrong answer", async () => {
  const { token } = await createContactChallenge();
  const valid = await verifyContactChallenge(token, "8");
  assert.equal(valid, false);
});

test("verifyContactChallenge rejects a tampered token", async () => {
  const { token } = await createContactChallenge();
  // Mutate a character in the payload segment so the signature no longer matches.
  const [header, payload, signature] = token.split(".");
  const mutatedPayload = payload.length > 10
    ? payload.slice(0, 10) + (payload[10] === "A" ? "B" : "A") + payload.slice(11)
    : payload.slice(0, 1) + (payload[0] === "A" ? "B" : "A") + payload.slice(2);
  const tampered = [header, mutatedPayload, signature].join(".");
  const valid = await verifyContactChallenge(tampered, "7");
  assert.equal(valid, false);
});

test("verifyContactChallenge rejects an expired token", async () => {
  const secret = new TextEncoder().encode(TEST_SECRET);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiredToken = await new SignJWT({ answer: "7" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSeconds - 600)
    .setExpirationTime(nowSeconds - 300)
    .sign(secret);
  const valid = await verifyContactChallenge(expiredToken, "7");
  assert.equal(valid, false);
});
