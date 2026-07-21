import assert from "node:assert/strict";
import test from "node:test";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import { ContactChallengeUnavailableError } from "../src/lib/contact/challenge.ts";
import {
  handleContactRequest,
  type ContactRequestRouteDependencies,
} from "../src/lib/contact/contact-request-route-core.ts";

const BODY = {
  name: "Field Service Manager",
  email: "manager@example.com",
  company: "Example Field Service",
  message: "Please contact us about an ERP rollout.",
  challenge: "contact_request",
  challengeToken: "signed-challenge-token",
  website: "",
};

function dependencies(
  overrides: Partial<ContactRequestRouteDependencies> = {},
): ContactRequestRouteDependencies {
  return {
    websiteOrigin: "https://erp.example.com",
    nodeEnv: "production",
    verifyChallenge: async () => true,
    create: async () => ({
      backendRequestId: "backend-request-id",
      data: {
        requestId: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
        status: "received",
        createdAt: "2026-07-13T12:00:00.000Z",
      },
    }),
    ...overrides,
  };
}

function request(body: unknown = BODY, headers: Record<string, string> = {}) {
  return new Request("https://erp.example.com/api/contact/request", {
    method: "POST",
    headers: {
      Origin: "https://erp.example.com",
      "Content-Type": "application/json",
      "Idempotency-Key": "contact-form-request-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("contact BFF verifies the challenge and forwards only bounded backend fields", async () => {
  let forwarded: unknown;
  let forwardedKey = "";
  let challenge: string[] = [];
  const response = await handleContactRequest(request(), dependencies({
    verifyChallenge: async (token, answer) => {
      challenge = [token, answer];
      return true;
    },
    create: async (input, idempotencyKey) => {
      forwarded = input;
      forwardedKey = idempotencyKey;
      return {
        backendRequestId: "backend-request-id",
        data: {
          requestId: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
          status: "received",
          createdAt: "2026-07-13T12:00:00.000Z",
        },
      };
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(challenge, [BODY.challengeToken, BODY.challenge]);
  assert.equal(forwardedKey, "contact-form-request-1");
  assert.deepEqual(forwarded, {
    name: BODY.name,
    email: BODY.email,
    company: BODY.company,
    subject: null,
    message: BODY.message,
  });
  assert.equal(JSON.stringify(await response.json()).includes(BODY.challengeToken), false);
});

test("contact BFF rejects untrusted origins, missing keys, honeypots, and bad challenges", async () => {
  let calls = 0;
  const deps = dependencies({
    create: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const badOrigin = await handleContactRequest(request(BODY, {
    Origin: "https://attacker.example",
  }), deps);
  const missingKey = await handleContactRequest(request(BODY, {
    "Idempotency-Key": "short",
  }), deps);
  const honeypot = await handleContactRequest(request({ ...BODY, website: "spam.example" }), deps);
  const badChallenge = await handleContactRequest(request(), dependencies({
    verifyChallenge: async () => false,
    create: deps.create,
  }));

  assert.equal(badOrigin.status, 403);
  assert.equal(missingKey.status, 400);
  assert.equal(honeypot.status, 400);
  assert.equal(badChallenge.status, 400);
  assert.equal(calls, 0);
});

test("contact BFF preserves validated backend throttling", async () => {
  const response = await handleContactRequest(request(), dependencies({
    create: async () => {
      throw new BackendTransportError({
        status: 429,
        code: "CONTACT_RATE_LIMITED",
        message: "Too many contact requests.",
        retryable: true,
        requestId: "backend-rate-limit",
      });
    },
  }));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "CONTACT_RATE_LIMITED",
      message: "Too many contact requests.",
      retryable: true,
    },
    meta: { requestId: "backend-rate-limit" },
  });
});

test("contact BFF reports Enterprise verification outages as retryable", async () => {
  const response = await handleContactRequest(request(), dependencies({
    verifyChallenge: async () => { throw new ContactChallengeUnavailableError(); },
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "CHALLENGE_UNAVAILABLE",
      message: "Contact verification is temporarily unavailable.",
      retryable: true,
    },
    meta: { requestId: body.meta.requestId },
  });
  assert.match(body.meta.requestId, /^[0-9a-f-]{36}$/i);
});
