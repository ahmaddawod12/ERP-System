import assert from "node:assert/strict";
import test from "node:test";
import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts";

import { createFederatedCredentialProvider } from "../src/aws-federation.js";

const now = Date.parse("2026-07-26T10:00:00Z");
const federation = {
  roleArn: "arn:aws:iam::123456789012:role/smart-job-email-ses",
  audience: "smart-job-email-production",
  subject: "123456789012345678901",
} as const;

function token(overrides: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: "https://accounts.google.com",
    aud: federation.audience,
    sub: federation.subject,
    azp: federation.subject,
    exp: Math.floor(now / 1000) + 3_600,
    ...overrides,
  })}.test-signature`;
}

test("federated credentials validate Google claims and cache STS results in memory", async () => {
  let tokenRequests = 0;
  let stsRequests = 0;
  const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
    now: () => now,
    fetchIdentityToken: async (audience) => {
      tokenRequests += 1;
      assert.equal(audience, federation.audience);
      return token();
    },
    assumeRole: async (roleArn, webIdentityToken, sessionName) => {
      stsRequests += 1;
      assert.equal(roleArn, federation.roleArn);
      assert.equal(webIdentityToken, token());
      assert.match(sessionName, /^smart-job-email-\d{12}$/);
      return {
        AccessKeyId: "temporary-access-key",
        SecretAccessKey: "temporary-secret-key",
        SessionToken: "temporary-session-token",
        Expiration: new Date(now + 3_600_000),
      };
    },
  });

  const [first, second] = await Promise.all([provider(), provider()]);
  assert.deepEqual(first, second);
  assert.equal((await provider()).accessKeyId, "temporary-access-key");
  assert.equal(tokenRequests, 1);
  assert.equal(stsRequests, 1);
});

test("federated credentials reject an unexpected audience before calling STS", async () => {
  let stsRequests = 0;
  const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
    now: () => now,
    fetchIdentityToken: async () => token({ aud: "wrong-audience" }),
    assumeRole: async () => {
      stsRequests += 1;
      return undefined;
    },
  });
  await assert.rejects(provider(), /audience is invalid/);
  assert.equal(stsRequests, 0);
});

test("federated credentials reject incomplete or nearly expired STS credentials", async () => {
  const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
    now: () => now,
    fetchIdentityToken: async () => token(),
    assumeRole: async () => ({
      AccessKeyId: "temporary-access-key",
      SecretAccessKey: "temporary-secret-key",
      SessionToken: "temporary-session-token",
      Expiration: new Date(now + 60_000),
    }),
  });
  await assert.rejects(provider(), /expire too soon/);
});

test("federated credentials reject malformed, wrong-issuer, wrong-subject, and expired tokens", async () => {
  for (const [candidate, expression] of [
    ["not-a-jwt", /malformed/],
    [token({ iss: "https://issuer.example.test" }), /issuer is invalid/],
    [token({ sub: "999999999999999999999" }), /subject is invalid/],
    [token({ exp: Math.floor(now / 1000) }), /expired or too close/],
  ] as const) {
    const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
      now: () => now,
      fetchIdentityToken: async () => candidate,
      assumeRole: async () => undefined,
    });
    await assert.rejects(provider(), expression);
  }
});

test("metadata identity requests are bounded and carry the required Google header", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "metadata.google.internal");
    assert.equal(url.searchParams.get("audience"), federation.audience);
    assert.equal(new Headers(init?.headers).get("Metadata-Flavor"), "Google");
    return new Response(token(), { status: 200 });
  }) as typeof fetch;
  const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
    now: () => now,
    assumeRole: async () => ({
      AccessKeyId: "temporary-access-key",
      SecretAccessKey: "temporary-secret-key",
      SessionToken: "temporary-session-token",
      Expiration: new Date(now + 3_600_000),
    }),
  });
  assert.equal((await provider()).sessionToken, "temporary-session-token");
});

test("default STS exchange requests one-hour web identity credentials", async (context) => {
  const originalSend = STSClient.prototype.send;
  context.after(() => {
    STSClient.prototype.send = originalSend;
  });
  STSClient.prototype.send = (async function (command) {
    const input = (command as unknown as AssumeRoleWithWebIdentityCommand).input;
    assert.equal(input.RoleArn, federation.roleArn);
    assert.equal(input.DurationSeconds, 3_600);
    assert.equal(input.WebIdentityToken, token());
    return {
      Credentials: {
        AccessKeyId: "temporary-access-key",
        SecretAccessKey: "temporary-secret-key",
        SessionToken: "temporary-session-token",
        Expiration: new Date(now + 3_600_000),
      },
    };
  }) as typeof STSClient.prototype.send;
  const provider = createFederatedCredentialProvider(federation, "eu-central-1", {
    now: () => now,
    fetchIdentityToken: async () => token(),
  });
  assert.equal((await provider()).accessKeyId, "temporary-access-key");
});
