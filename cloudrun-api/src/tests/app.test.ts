import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { createApiResponseSchema } from "@smart-job/api-contracts";
import { z } from "zod";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { apiSuccess } from "../http/envelope.js";

const healthEnvelopeSchema = createApiResponseSchema(
  z.object({ status: z.literal("ok") }).strict(),
);
const readinessEnvelopeSchema = createApiResponseSchema(
  z.object({ status: z.literal("ready") }).strict(),
);
const errorEnvelopeSchema = createApiResponseSchema(z.never());

test("healthz returns a success envelope and echoes a trusted request ID", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { "x-request-id": "web-req_123" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "web-req_123");
  assert.equal(response.headers["cache-control"], undefined);
  assert.deepEqual(healthEnvelopeSchema.parse(response.json()), {
    ok: true,
    data: { status: "ok" },
    meta: { requestId: "web-req_123" },
  });
});

test("invalid incoming request IDs are replaced with generated UUIDs", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { "x-request-id": "not valid because it contains spaces" },
  });

  const requestId = response.headers["x-request-id"];
  assert.equal(typeof requestId, "string");
  assert.notEqual(requestId, "not valid because it contains spaces");
  assert.match(String(requestId), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("readyz reports readiness through the common envelope", async (context) => {
  let checks = 0;
  const app = await buildApp({
    config: loadConfig({}),
    logger: false,
    readinessCheck: () => {
      checks += 1;
    },
  });
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/readyz" });
  const parsed = readinessEnvelopeSchema.parse(response.json());

  assert.equal(response.statusCode, 200);
  assert.equal(checks, 1);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meta.requestId, response.headers["x-request-id"]);
});

test("readyz returns a retryable 503 without exposing dependency errors", async (context) => {
  const app = await buildApp({
    config: loadConfig({}),
    logger: false,
    readinessCheck: () => {
      throw new Error("database password should not be returned");
    },
  });
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/readyz" });
  const parsed = errorEnvelopeSchema.parse(response.json());

  assert.equal(response.statusCode, 503);
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    assert.fail("expected an error envelope");
  }
  assert.deepEqual(parsed.error, {
    code: "SERVICE_NOT_READY",
    message: "The service is not ready to accept traffic.",
    retryable: true,
  });
  assert.doesNotMatch(parsed.error.message, /password/i);
});

test("OpenAPI binds success and failure envelopes to the correct readiness statuses", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  await app.ready();

  const document = app.swagger() as {
    paths?: Record<string, {
      get?: { responses?: Record<string, { content?: { "application/json"?: { schema?: unknown } } }> };
    }>;
  };
  const responses = document.paths?.["/readyz"]?.get?.responses;
  const successSchema = responses?.["200"]?.content?.["application/json"]?.schema;
  const failureSchema = responses?.["503"]?.content?.["application/json"]?.schema;

  assert.match(JSON.stringify(successSchema), /\[true\]/);
  assert.doesNotMatch(JSON.stringify(successSchema), /\[false\]/);
  assert.match(JSON.stringify(failureSchema), /\[false\]/);
  assert.doesNotMatch(JSON.stringify(failureSchema), /\[true\]/);
});

test("API v1 responses are private/no-store and 404s use the common error envelope", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());

  for (const url of ["/api/v1", "/api/v1/jobs?limit=50"]) {
    const response = await app.inject({ method: "GET", url });
    const parsed = errorEnvelopeSchema.parse(response.json());

    assert.equal(response.statusCode, 404);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      assert.fail("expected an error envelope");
    }
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.equal(parsed.meta.requestId, response.headers["x-request-id"]);
  }
});

test("query strings and malformed body contents are excluded from structured logs", async (context) => {
  let logs = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += String(chunk);
      callback();
    },
  });
  const app = await buildApp({
    config: loadConfig({}),
    logger: { level: "info", stream },
  });
  context.after(() => app.close());
  app.post("/api/v1/log-boundary", async (request) => apiSuccess(request.id, { accepted: true }));

  await app.inject({ method: "GET", url: "/api/v1/missing?secret=query-leak-marker" });
  await app.inject({
    method: "POST",
    url: "/api/v1/log-boundary",
    headers: { "content-type": "application/json" },
    payload: "body-leak-marker",
  });

  assert.doesNotMatch(logs, /query-leak-marker|body-leak-marker/);
  assert.match(logs, /\/api\/v1\/missing/);
});

test("Fastify body errors retain safe non-retryable 4xx classifications", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  app.post("/api/v1/body-boundary", async (request) => apiSuccess(request.id, { accepted: true }));

  const cases = [
    {
      request: {
        method: "POST" as const,
        url: "/api/v1/body-boundary",
        headers: { "content-type": "application/json" },
        payload: "not-json",
      },
      statusCode: 400,
      code: "INVALID_REQUEST_BODY",
    },
    {
      request: {
        method: "POST" as const,
        url: "/api/v1/body-boundary",
        headers: { "content-type": "application/x-smart-job-unsupported" },
        payload: "content",
      },
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      request: {
        method: "POST" as const,
        url: "/api/v1/body-boundary",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ value: "x".repeat(1_048_576) }),
      },
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
  ];

  for (const testCase of cases) {
    const response = await app.inject(testCase.request);
    const parsed = errorEnvelopeSchema.parse(response.json());
    assert.equal(response.statusCode, testCase.statusCode);
    assert.equal(parsed.ok, false);
    if (parsed.ok) assert.fail("expected an error envelope");
    assert.equal(parsed.error.code, testCase.code);
    assert.equal(parsed.error.retryable, false);
  }
});

test("handler execution is capped by the configured service deadline", async (context) => {
  const app = await buildApp({
    config: loadConfig({ REQUEST_TIMEOUT_MS: "20" }),
    logger: false,
  });
  context.after(() => app.close());
  app.get("/api/v1/slow", async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return apiSuccess(request.id, { completed: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/v1/slow" });
  const parsed = errorEnvelopeSchema.parse(response.json());
  assert.equal(response.statusCode, 504);
  assert.equal(parsed.ok, false);
  if (parsed.ok) assert.fail("expected an error envelope");
  assert.deepEqual(parsed.error, {
    code: "REQUEST_TIMEOUT",
    message: "The request exceeded the service time limit.",
    retryable: true,
  });
});
