import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { ServiceConfig } from "../src/config.js";
import { success } from "../src/envelopes.js";

const testConfig: ServiceConfig = {
  host: "127.0.0.1",
  port: 8080,
  logLevel: "silent",
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
      url: "/api/v1/tax/callback?credential=must-not-be-logged",
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
