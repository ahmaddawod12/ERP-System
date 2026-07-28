import assert from "node:assert/strict";
import test from "node:test";

import { buildApp, type EmailWorkerDependencies } from "../src/app.js";
import type { CanonicalEmailDelivery } from "../src/database.js";

const delivery: CanonicalEmailDelivery = {
  leaseToken: "4f07f57c-96f4-490b-b56c-15bc57d88f91",
  deliveryId: "af4d52c8-896d-4b1b-8c99-42d24a460880",
  companyId: "9a62e275-5f96-4530-a921-d1788b7dcdb1",
  publicCompanyId: 77,
  documentId: "45487df7-6142-4c5e-9806-0d624e8447fb",
  documentCode: "TI-77-1",
  documentNumber: 1,
  documentType: 305,
  language: "he",
  recipientEmail: "customer@example.test",
  recipientName: "Customer",
  businessName: "Workflow Company",
  storagePath: "9a62e275-5f96-4530-a921-d1788b7dcdb1/documents/45487df7-6142-4c5e-9806-0d624e8447fb.pdf",
  attempt: 1,
};

function pushPayload(value: unknown) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
    },
  };
}

function dependencies(overrides: Partial<EmailWorkerDependencies> = {}): EmailWorkerDependencies {
  return {
    config: {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 8080,
      database: { connectionString: "postgresql://localhost/test", ssl: false, max: 1 },
      pubsub: { audience: undefined, allowedServiceAccounts: [], sharedToken: "test-token" },
      storage: {
        projectId: "smart-job-test",
        bucket: "smart-job-company-files",
        signedUrlTtlSeconds: 300,
      },
      ses: {
        region: "eu-central-1",
        fromEmail: "documents@example.test",
        fromName: "Smart-Job",
        credentialMode: "static",
      },
      sendLeaseSeconds: 60,
    },
    authorize: async () => true,
    store: {
      claim: async () => delivery,
      complete: async () => undefined,
      resolveFailure: async () => undefined,
    },
    signDownload: async () => "https://storage.example.test/signed-document",
    sender: { send: async () => "ses-message-1" },
    checkReadiness: async () => undefined,
    ...overrides,
  };
}

test("email worker accepts only opaque delivery ids and completes one canonical send", async (context) => {
  const events: string[] = [];
  const app = buildApp(dependencies({
    store: {
      claim: async (deliveryId) => {
        events.push(`claim:${deliveryId}`);
        return delivery;
      },
      complete: async (_delivery, providerMessageId) => {
        events.push(`complete:${providerMessageId}`);
      },
      resolveFailure: async () => assert.fail("successful send must not resolve a failure"),
    },
    sender: {
      send: async (canonical, downloadUrl) => {
        assert.equal(canonical.recipientEmail, delivery.recipientEmail);
        assert.equal(downloadUrl, "https://storage.example.test/signed-document");
        events.push("send");
        return "ses-message-1";
      },
    },
  }));
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/deliver",
    payload: pushPayload({ deliveryId: delivery.deliveryId }),
  });
  assert.equal(response.statusCode, 204, response.body);
  assert.deepEqual(events, [
    `claim:${delivery.deliveryId}`,
    "send",
    "complete:ses-message-1",
  ]);

  const forged = await app.inject({
    method: "POST",
    url: "/deliver",
    payload: pushPayload({
      deliveryId: delivery.deliveryId,
      recipientEmail: "attacker@example.test",
    }),
  });
  assert.equal(forged.statusCode, 400);
  assert.equal(events.length, 3, "forged authority fields must be rejected before claim");
});

test("healthz is process-only and readyz fails closed without dependency readiness", async (context) => {
  const { checkReadiness: _checkReadiness, ...withoutReadiness } = dependencies();
  const app = buildApp(withoutReadiness);
  context.after(() => app.close());
  const health = await app.inject({ method: "GET", url: "/healthz" });
  const alias = await app.inject({ method: "GET", url: "/health" });
  const readiness = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(health.statusCode, 200);
  assert.equal(alias.statusCode, 200);
  assert.equal(readiness.statusCode, 503);
  assert.doesNotMatch(readiness.body, /database|storage|ses|credential/i);
});

test("authenticated poison messages return non-2xx for Pub/Sub retry and DLQ", async (context) => {
  let claims = 0;
  const app = buildApp(dependencies({
    store: {
      claim: async () => { claims += 1; return null; },
      complete: async () => undefined,
      resolveFailure: async () => undefined,
    },
  }));
  context.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/deliver",
    headers: {
      "x-goog-pubsub-topic": "projects/example/topics/email-delivery",
    },
    payload: {
      deliveryAttempt: 3,
      message: {
        data: Buffer.from("{not-json", "utf8").toString("base64"),
        attributes: { schemaVersion: "v1" },
      },
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(claims, 0);
  assert.doesNotMatch(response.body, /not-json|data/i);
});

test("ambiguous SES failure becomes delivery_unknown without automatic resend", async (context) => {
  const outcomes: string[] = [];
  const app = buildApp(dependencies({
    store: {
      claim: async () => delivery,
      complete: async () => assert.fail("ambiguous submission must not complete"),
      resolveFailure: async (_delivery, outcome) => { outcomes.push(outcome); },
    },
    sender: { send: async () => { throw new Error("socket closed after write"); } },
  }));
  context.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/deliver",
    payload: pushPayload({ deliveryId: delivery.deliveryId }),
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(outcomes, ["delivery_unknown"]);
});

test("definite pre-send failure is deferred without calling SES", async (context) => {
  const outcomes: string[] = [];
  let sends = 0;
  const app = buildApp(dependencies({
    store: {
      claim: async () => delivery,
      complete: async () => assert.fail("pre-send failure must not complete"),
      resolveFailure: async (_delivery, outcome) => { outcomes.push(outcome); },
    },
    signDownload: async () => { throw new Error("storage unavailable"); },
    sender: { send: async () => { sends += 1; return "unexpected"; } },
  }));
  context.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/deliver",
    payload: pushPayload({ deliveryId: delivery.deliveryId }),
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(outcomes, ["queued"]);
  assert.equal(sends, 0);
});
