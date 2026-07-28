import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_RECAPTCHA_ACTION,
  ContactChallengeUnavailableError,
  createContactChallenge,
  verifyContactChallenge,
} from "../src/lib/contact/challenge.ts";

const productionEnvironment = {
  WEBSITE_ORIGIN: "https://erp.example.com",
  RECAPTCHA_ENTERPRISE_PROJECT_ID: "smart-job-prod-123",
  NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY: "enterprise_site_key_1234567890",
  RECAPTCHA_ENTERPRISE_MIN_SCORE: "0.7",
};

const localEnvironment = {
  SMART_JOB_DEPLOYMENT_ENV: "local",
  SMART_JOB_LOCAL_PLATFORM: "true",
  SMART_JOB_LOCAL_PLATFORM_VERIFIED: "true",
  LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
  WEBSITE_SESSION_SECRET: "test-local-contact-proof-secret-32-bytes",
};

test("contact challenge exposes only Enterprise public configuration", async () => {
  const challenge = await createContactChallenge(productionEnvironment);
  assert.deepEqual(challenge, {
    provider: "recaptcha-enterprise",
    action: CONTACT_RECAPTCHA_ACTION,
    siteKey: productionEnvironment.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
  });
  assert.doesNotMatch(JSON.stringify(challenge), /secret|project/i);
});

test("Enterprise assessment binds token, site key, action, hostname and score", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      tokenProperties: {
        valid: true,
        action: CONTACT_RECAPTCHA_ACTION,
        hostname: "erp.example.com",
      },
      riskAnalysis: { score: 0.9 },
    });
  };
  const valid = await verifyContactChallenge(
    "enterprise-response-token-value",
    CONTACT_RECAPTCHA_ACTION,
    {
      env: productionEnvironment,
      fetchImpl,
      accessToken: async () => "metadata-access-token",
    },
  );
  assert.equal(valid, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /recaptchaenterprise\.googleapis\.com\/v1\/projects\/smart-job-prod-123\/assessments$/);
  assert.equal(requests[0]?.init?.redirect, "error");
  assert.equal((requests[0]?.init?.headers as Record<string, string>).authorization, "Bearer metadata-access-token");
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.deepEqual(body.event, {
    token: "enterprise-response-token-value",
    siteKey: productionEnvironment.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
    expectedAction: CONTACT_RECAPTCHA_ACTION,
  });
});

test("Enterprise assessment fails closed on action, hostname and risk mismatches", async () => {
  for (const payload of [
    { tokenProperties: { valid: true, action: "other", hostname: "erp.example.com" }, riskAnalysis: { score: 0.9 } },
    { tokenProperties: { valid: true, action: CONTACT_RECAPTCHA_ACTION, hostname: "attacker.example" }, riskAnalysis: { score: 0.9 } },
    { tokenProperties: { valid: true, action: CONTACT_RECAPTCHA_ACTION, hostname: "erp.example.com" }, riskAnalysis: { score: 0.2 } },
  ]) {
    const valid = await verifyContactChallenge(
      "enterprise-response-token-value",
      CONTACT_RECAPTCHA_ACTION,
      {
        env: productionEnvironment,
        accessToken: async () => "metadata-access-token",
        fetchImpl: async () => Response.json(payload),
      },
    );
    assert.equal(valid, false);
  }
});

test("verified local platform uses an expiring proof without an arithmetic bypass", async () => {
  const challenge = await createContactChallenge(localEnvironment);
  assert.equal(challenge.provider, "local-proof");
  if (challenge.provider !== "local-proof") throw new Error("wrong provider");
  assert.equal(await verifyContactChallenge(challenge.token, challenge.action, { env: localEnvironment }), true);
  assert.equal(await verifyContactChallenge(challenge.token, "other", { env: localEnvironment }), false);
  assert.doesNotMatch(JSON.stringify(challenge), /3 \+ 4|answer/);
});

test("assessment transport failures are retryable verification failures", async () => {
  await assert.rejects(
    verifyContactChallenge("enterprise-response-token-value", CONTACT_RECAPTCHA_ACTION, {
      env: productionEnvironment,
      accessToken: async () => "metadata-access-token",
      fetchImpl: async () => new Response("upstream failed", { status: 503 }),
    }),
    ContactChallengeUnavailableError,
  );
});
