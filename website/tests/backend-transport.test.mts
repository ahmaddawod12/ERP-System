import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  loadBackendRuntimeConfig,
  parseBackendBaseUrl,
} from "../src/lib/backend/config.ts";
import {
  BackendTransportError,
  createBackendTransport,
} from "../src/lib/backend/transport-core.ts";

test("backend runtime config requires a secure server-only base URL", () => {
  assert.equal(
    parseBackendBaseUrl("https://api.example.com/", "production"),
    "https://api.example.com",
  );
  assert.equal(
    parseBackendBaseUrl("http://127.0.0.1:8080", "development"),
    "http://127.0.0.1:8080",
  );
  assert.throws(
    () => parseBackendBaseUrl("http://api.example.com", "development"),
    /HTTPS/,
  );
  assert.throws(
    () => parseBackendBaseUrl("http://localhost:8080", "production"),
    /production/,
  );
  assert.equal(
    parseBackendBaseUrl("http://cloudrun-api:8080", "production", true),
    "http://cloudrun-api:8080",
  );
  assert.throws(
    () => parseBackendBaseUrl("https://api.example.com/prefix", "production"),
    /must not contain a path/,
  );

  assert.deepEqual(loadBackendRuntimeConfig({
    BACKEND_API_BASE_URL: "https://api.example.com",
    BACKEND_API_TIMEOUT_MS: "9000",
    NODE_ENV: "production",
  }), {
    baseUrl: "https://api.example.com",
    timeoutMs: 9000,
  });

  const localEnvironment: NodeJS.ProcessEnv = {
    BACKEND_API_BASE_URL: "http://cloudrun-api:8080",
    NODE_ENV: "production",
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    SMART_JOB_LOCAL_PLATFORM_VERIFIED: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
  };
  assert.equal(loadBackendRuntimeConfig(localEnvironment).baseUrl, "http://cloudrun-api:8080");
  assert.throws(
    () => loadBackendRuntimeConfig({
      ...localEnvironment,
      SMART_JOB_LOCAL_PLATFORM_VERIFIED: undefined,
    }),
    /verified local-platform entrypoint/,
  );
});

test("backend transport validates the canonical envelope and disables caching", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const transport = createBackendTransport({
    baseUrl: "https://api.example.com",
    timeoutMs: 1_000,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        ok: true,
        data: { value: 7 },
        meta: { requestId: "req-1" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await transport.request(
    "/api/v1/example",
    z.object({ value: z.number().int() }).strict(),
    { headers: { Authorization: "SmartJobSession opaque" } },
  );

  assert.deepEqual(result, { data: { value: 7 }, meta: { requestId: "req-1" } });
  assert.equal(capturedUrl, "https://api.example.com/api/v1/example");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(new Headers(capturedInit?.headers).get("accept"), "application/json");
  assert.equal(
    new Headers(capturedInit?.headers).get("authorization"),
    "SmartJobSession opaque",
  );
});

test("backend transport rejects malformed responses instead of trusting them", async () => {
  const transport = createBackendTransport({
    baseUrl: "https://api.example.com",
    timeoutMs: 1_000,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      data: { value: "not-a-number" },
      meta: { requestId: "req-2" },
    })),
  });

  await assert.rejects(
    transport.request("/api/v1/example", z.object({ value: z.number() })),
    (error: unknown) => error instanceof BackendTransportError
      && error.status === 502
      && error.code === "BACKEND_RESPONSE_INVALID",
  );
});

test("backend transport preserves validated backend errors without exposing raw payloads", async () => {
  const transport = createBackendTransport({
    baseUrl: "https://api.example.com",
    timeoutMs: 1_000,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
        retryable: false,
      },
      meta: { requestId: "req-auth" },
    }), { status: 401 }),
  });

  await assert.rejects(
    transport.request("/api/v1/auth/web-sessions", z.object({ ignored: z.boolean() })),
    (error: unknown) => error instanceof BackendTransportError
      && error.status === 401
      && error.code === "INVALID_CREDENTIALS"
      && error.requestId === "req-auth",
  );
});

test("backend transport refuses paths outside the versioned API", async () => {
  const transport = createBackendTransport({
    baseUrl: "https://api.example.com",
    timeoutMs: 1_000,
    fetchImpl: async () => new Response(),
  });

  await assert.rejects(
    transport.request("//attacker.example/api/v1/me", z.unknown()),
    (error: unknown) => error instanceof BackendTransportError
      && error.code === "BACKEND_PATH_INVALID",
  );
});

test("backend timeout remains active while the response body is being consumed", async () => {
  const transport = createBackendTransport({
    baseUrl: "https://api.example.com",
    timeoutMs: 10,
    fetchImpl: async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { status: 200 });
    },
  });

  await assert.rejects(
    transport.request("/api/v1/example", z.unknown()),
    (error: unknown) => error instanceof BackendTransportError
      && error.status === 504
      && error.code === "BACKEND_TIMEOUT",
  );
});
