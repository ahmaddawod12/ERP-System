import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp, type BuildAppDependencies } from "../src/app.js";
import {
  createCallbackSignature,
  HmacTaxCallbackAuthenticator,
  type TaxCallbackAuthenticator,
} from "../src/callback.js";
import type { ServiceConfig } from "../src/config.js";
import type {
  BindTaxApprovalSessionRequest,
  ForwardTaxCallbackRequest,
  ForwardTaxCallbackResult,
  NormalizedTaxCallback,
  OAuthTokenResult,
  TaxApprovalResult,
} from "../src/contracts.js";
import { TaxGatewayError } from "../src/errors.js";
import { success } from "../src/envelopes.js";
import type { MainApiCallbackClient } from "../src/main-api-client.js";
import type { ServiceIdentityVerifier } from "../src/service-identity.js";
import type { TaxAuthorityClient } from "../src/authority-client.js";

const testConfig: ServiceConfig = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 8080,
  logLevel: "silent",
  outboundTimeoutMs: 8_000,
  taxGatewayAudience: "",
  taxApprovalCallerServiceAccount: "",
};

const apps: FastifyInstance[] = [];

function createApp(): FastifyInstance {
  const app = buildApp({ config: testConfig, logger: false });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("service probes", () => {
  it("returns a common success envelope from /healthz", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "request-health-1" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-request-id"], "request-health-1");
    assert.deepEqual(response.json(), {
      ok: true,
      data: { status: "ok", service: "cloudrun-tax" },
      meta: { requestId: "request-health-1" },
    });
  });

  it("returns a common success envelope from /readyz", async () => {
    const response = await createApp().inject({ method: "GET", url: "/readyz" });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["x-request-id"] as string, /^[0-9a-f-]{36}$/);
    assert.deepEqual(body, {
      ok: true,
      data: { status: "ready", service: "cloudrun-tax" },
      meta: { requestId: response.headers["x-request-id"] },
    });
  });
});

describe("request boundary", () => {
  it("replaces unsafe request IDs instead of reflecting them", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "contains spaces" },
    });

    assert.equal(response.statusCode, 200);
    assert.notEqual(response.headers["x-request-id"], "contains spaces");
    assert.match(response.headers["x-request-id"] as string, /^[0-9a-f-]{36}$/);
  });

  it("returns the common error envelope for unknown routes", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/api/v1/tax/unknown-route?credential=must-not-be-logged",
      payload: { invoice: "must-not-be-logged" },
      headers: { "x-request-id": "request-missing-1" },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested route does not exist",
        retryable: false,
      },
      meta: { requestId: "request-missing-1" },
    });
  });

  it("keeps malformed and unsupported bodies as non-retryable client errors", async () => {
    const app = createApp();
    app.post("/api/v1/tax/test-boundary", async (request) =>
      success(request.id, { accepted: true }),
    );

    const cases = [
      {
        request: {
          method: "POST" as const,
          url: "/api/v1/tax/test-boundary",
          headers: { "content-type": "application/json" },
          payload: "not-json",
        },
        statusCode: 400,
        code: "INVALID_REQUEST_BODY",
      },
      {
        request: {
          method: "POST" as const,
          url: "/api/v1/tax/test-boundary",
          headers: { "content-type": "application/x-smart-job-unsupported" },
          payload: "content",
        },
        statusCode: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      {
        request: {
          method: "POST" as const,
          url: "/api/v1/tax/test-boundary",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ value: "x".repeat(1_048_576) }),
        },
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject(testCase.request);
      const body = response.json();
      assert.equal(response.statusCode, testCase.statusCode);
      assert.equal(body.ok, false);
      assert.equal(body.error.code, testCase.code);
      assert.equal(body.error.retryable, false);
    }
  });
});

const HMAC_SECRET = "test-hmac-secret-with-at-least-32-characters!!";

function encodeCallbackData(callback: NormalizedTaxCallback): string {
  return Buffer.from(JSON.stringify(callback), "utf8").toString("base64");
}

function validCallback(): NormalizedTaxCallback {
  return {
    oauthSessionId: "session-abc-123",
    status: "approved",
    confirmationNumber: "CONF-2026-0001",
  };
}

function validHeaders(eventId: string, data: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createCallbackSignature(HMAC_SECRET, { eventId, timestamp, encodedData: data });
  return {
    "x-sj-tax-event-id": eventId,
    "x-sj-tax-timestamp": timestamp,
    "x-sj-tax-signature": signature,
  };
}

function createCallbackApp(deps: BuildAppDependencies): FastifyInstance {
  const app = buildApp({ config: testConfig, logger: false, dependencies: deps });
  apps.push(app);
  return app;
}

function createMockCallbackClient(
  forward: (request: ForwardTaxCallbackRequest) => Promise<ForwardTaxCallbackResult>,
  bind: (request: BindTaxApprovalSessionRequest) => Promise<{ bound: true; idempotentReplay: boolean }> =
    async () => ({ bound: true, idempotentReplay: false }),
): MainApiCallbackClient {
  return {
    bindApprovalSession: bind,
    forwardCallback: forward,
  };
}

function createPassAuthenticator(): TaxCallbackAuthenticator {
  return { verify() {} };
}

describe("POST /api/v1/tax/callback", () => {
  it("returns 503 when the gateway is not operationally configured", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data: "test" } },
      headers: { "x-request-id": "request-callback-1" },
    });

    assert.equal(response.statusCode, 503);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "TAX_GATEWAY_NOT_CONFIGURED");
    assert.equal(body.error.retryable, true);
  });

  it("returns 401 when callback authentication headers are missing", async () => {
    const app = createCallbackApp({
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data: "test" } },
    });

    assert.equal(response.statusCode, 401);
    const body = response.json();
    assert.equal(body.error.code, "INVALID_CALLBACK_AUTHENTICATION");
    assert.equal(body.error.retryable, false);
  });

  it("returns 400 when the body does not match the callback envelope contract", async () => {
    const app = createCallbackApp({
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { wrong: "shape" },
      headers: {
        "x-sj-tax-event-id": "event-1234",
        "x-sj-tax-timestamp": String(Math.floor(Date.now() / 1_000)),
        "x-sj-tax-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.error.retryable, false);
  });

  it("returns 401 when HMAC signature verification fails", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const data = encodeCallbackData(validCallback());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data } },
      headers: {
        "x-sj-tax-event-id": "event-1234",
        "x-sj-tax-timestamp": String(Math.floor(Date.now() / 1_000)),
        "x-sj-tax-signature": "sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    });

    assert.equal(response.statusCode, 401);
    const body = response.json();
    assert.equal(body.error.code, "INVALID_CALLBACK_AUTHENTICATION");
  });

  it("forwards an authenticated callback and returns the main-API result", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    let captured: ForwardTaxCallbackRequest | undefined;
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async (request) => {
        captured = request;
        return { processed: true, idempotentReplay: false };
      }),
    });

    const data = encodeCallbackData(validCallback());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data, messageId: "event-1234" } },
      headers: validHeaders("event-1234", data),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      ok: true,
      data: { processed: true, idempotentReplay: false },
      meta: { requestId: response.headers["x-request-id"] },
    });
    assert.ok(captured !== undefined);
    assert.equal(captured.eventId, "event-1234");
    assert.equal(captured.callback.status, "approved");
    assert.equal(captured.callback.confirmationNumber, "CONF-2026-0001");
    assert.match(captured.payloadHash, /^[a-f0-9]{64}$/);
  });

  it("maps a main-API unavailability failure to a retryable 503", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => {
        throw new TaxGatewayError(503, "MAIN_API_UNAVAILABLE", "The protected main API is temporarily unavailable.", true);
      }),
    });

    const data = encodeCallbackData(validCallback());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data } },
      headers: validHeaders("event-5678", data),
    });

    assert.equal(response.statusCode, 503);
    const body = response.json();
    assert.equal(body.error.code, "MAIN_API_UNAVAILABLE");
    assert.equal(body.error.retryable, true);
  });

  it("maps a main-API idempotency conflict to 409", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => {
        throw new TaxGatewayError(409, "CALLBACK_IDEMPOTENCY_CONFLICT", "The callback event ID was already used for different content.", false);
      }),
    });

    const data = encodeCallbackData(validCallback());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data } },
      headers: validHeaders("event-conflict", data),
    });

    assert.equal(response.statusCode, 409);
    const body = response.json();
    assert.equal(body.error.code, "CALLBACK_IDEMPOTENCY_CONFLICT");
    assert.equal(body.error.retryable, false);
  });

  it("rejects a callback with a stale timestamp outside the skew window", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const data = encodeCallbackData(validCallback());
    const staleTimestamp = String(Math.floor(Date.now() / 1_000) - 600);
    const signature = createCallbackSignature(HMAC_SECRET, {
      eventId: "event-stale",
      timestamp: staleTimestamp,
      encodedData: data,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data } },
      headers: {
        "x-sj-tax-event-id": "event-stale",
        "x-sj-tax-timestamp": staleTimestamp,
        "x-sj-tax-signature": signature,
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "INVALID_CALLBACK_AUTHENTICATION");
  });

  it("rejects a callback whose message data is not valid JSON", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const badData = Buffer.from("not-json", "utf8").toString("base64");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data: badData } },
      headers: validHeaders("event-bad-json", badData),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  });

  it("rejects a callback whose decoded data does not match the normalized schema", async () => {
    const authenticator = new HmacTaxCallbackAuthenticator(HMAC_SECRET, 300);
    const app = createCallbackApp({
      callbackAuthenticator: authenticator,
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const invalidCallback = { oauthSessionId: "x", status: "unknown-status" };
    const data = Buffer.from(JSON.stringify(invalidCallback), "utf8").toString("base64");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback",
      payload: { message: { data } },
      headers: validHeaders("event-bad-schema", data),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  });

  it("does not log the credential query parameter on a callback URL", async () => {
    const app = createCallbackApp({
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/callback?credential=must-not-be-logged",
      payload: { message: { data: "test" } },
    });

    assert.equal(response.statusCode, 401);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INVALID_CALLBACK_AUTHENTICATION");
  });
});

function createApprovalApp(deps: BuildAppDependencies): FastifyInstance {
  const app = buildApp({ config: testConfig, logger: false, dependencies: deps });
  apps.push(app);
  return app;
}

function createPassIdentityVerifier(): ServiceIdentityVerifier {
  return {
    async verifyAuthorizationHeader() {
      return { subject: "123456789", email: "smart-job-api@project.iam.gserviceaccount.com" };
    },
  };
}

function createMockAuthorityClient(
  exchange: () => Promise<OAuthTokenResult>,
  approve: (invoice: Record<string, unknown>) => Promise<TaxApprovalResult>,
): TaxAuthorityClient {
  return {
    async exchangeToken() {
      return exchange();
    },
    async requestApproval(request) {
      return approve(request.invoice);
    },
  };
}

describe("POST /api/v1/tax/approval", () => {
  it("returns 503 when the gateway is not operationally configured", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-1", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "TAX_GATEWAY_NOT_CONFIGURED");
  });

  it("returns 400 when the body does not match the approval contract", async () => {
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => ({ accessToken: "token", tokenType: "Bearer", expiresInSeconds: 3600 }),
        async () => ({ status: "approved", confirmationNumber: "CONF-1" }),
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
      approvalIdentityVerifier: createPassIdentityVerifier(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      headers: { authorization: "Bearer fake-token" },
      payload: { wrong: "shape" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  });

  it("exchanges OAuth token, requests approval, and returns the result", async () => {
    let exchanged = false;
    let boundSession: BindTaxApprovalSessionRequest | undefined;
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => {
          exchanged = true;
          return { accessToken: "test-access-token", tokenType: "Bearer", expiresInSeconds: 3600 };
        },
        async (invoice) => {
          assert.equal(exchanged, true);
          assert.deepEqual(invoice, { field: "value" });
          return { status: "approved", confirmationNumber: "CONF-2026-0001" };
        },
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(
        async () => ({ processed: true }),
        async (request) => {
          boundSession = request;
          return { bound: true, idempotentReplay: false };
        },
      ),
      approvalIdentityVerifier: createPassIdentityVerifier(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      headers: { authorization: "Bearer fake-token" },
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-abc", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, "approved");
    assert.equal(body.data.confirmationNumber, "CONF-2026-0001");
    assert.equal(boundSession?.documentId, "3b5cc006-75cb-45cb-b13d-6db90b568e14");
    assert.equal(boundSession?.oauthSessionId, "session-abc");
    assert.equal(exchanged, true);
  });

  it("returns a pending result for accepted submissions", async () => {
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => ({ accessToken: "token", tokenType: "Bearer", expiresInSeconds: 3600 }),
        async () => ({ status: "pending" }),
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
      approvalIdentityVerifier: createPassIdentityVerifier(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      headers: { authorization: "Bearer fake-token" },
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-pending", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.status, "pending");
  });

  it("maps an OAuth rejection to 401", async () => {
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => {
          throw new TaxGatewayError(401, "TAX_OAUTH_REJECTED", "The tax authority rejected the oauth request.", false);
        },
        async () => ({ status: "approved", confirmationNumber: "CONF-1" }),
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
      approvalIdentityVerifier: createPassIdentityVerifier(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      headers: { authorization: "Bearer fake-token" },
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-oauth-fail", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "TAX_OAUTH_REJECTED");
  });

  it("maps a tax authority unavailability to retryable 503", async () => {
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => ({ accessToken: "token", tokenType: "Bearer", expiresInSeconds: 3600 }),
        async () => {
          throw new TaxGatewayError(503, "TAX_AUTHORITY_UNAVAILABLE", "The tax authority is temporarily unavailable.", true);
        },
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
      approvalIdentityVerifier: createPassIdentityVerifier(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      headers: { authorization: "Bearer fake-token" },
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-unavail", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "TAX_AUTHORITY_UNAVAILABLE");
    assert.equal(response.json().error.retryable, true);
  });

  it("rejects a request without authorization header", async () => {
    const app = createApprovalApp({
      authorityClient: createMockAuthorityClient(
        async () => ({ accessToken: "token", tokenType: "Bearer", expiresInSeconds: 3600 }),
        async () => ({ status: "approved", confirmationNumber: "CONF-1" }),
      ),
      callbackAuthenticator: createPassAuthenticator(),
      callbackClient: createMockCallbackClient(async () => ({ processed: true })),
      approvalIdentityVerifier: {
        async verifyAuthorizationHeader(header) {
          if (header === undefined) {
            throw new TaxGatewayError(401, "INTERNAL_IDENTITY_INVALID", "A valid internal service identity is required.", false);
          }
          return { subject: "123456789", email: "test@project.iam.gserviceaccount.com" };
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/approval",
      payload: { documentId: "3b5cc006-75cb-45cb-b13d-6db90b568e14", oauthSessionId: "session-no-auth", invoice: { field: "value" } },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "INTERNAL_IDENTITY_INVALID");
  });
});
