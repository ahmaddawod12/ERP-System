import assert from "node:assert/strict";
import test from "node:test";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleUpgradeRequestCreate,
  handleUpgradeRequestModeration,
  type UpgradeRequestRouteDependencies,
} from "../src/lib/upgrade/upgrade-request-route-core.ts";

const SESSION_TOKEN = "s".repeat(43);
const CSRF_TOKEN = "c".repeat(43);
const REQUEST_ID = "9b3792bb-8f01-46d8-9817-f552f91e7faa";
const SUMMARY = {
  requestId: REQUEST_ID,
  requesterUid: "4500a9a4-9765-4d80-8be8-ff9872058bb9",
  requesterEmail: "manager@example.com",
  companyId: 1042,
  role: "manager" as const,
  currentTier: "Team" as const,
  requestedTier: "Enterprise" as const,
  message: "We need the enterprise tier for a larger field team.",
  status: "pending" as const,
  moderationNote: null,
  moderatedAt: null,
  moderatedByName: null,
  appliedAt: null,
  entityVersion: "ev1.MQ" as never,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

function dependencies(
  overrides: Partial<UpgradeRequestRouteDependencies> = {},
): UpgradeRequestRouteDependencies {
  return {
    websiteOrigin: "https://erp.example.com",
    nodeEnv: "production",
    create: async () => ({ data: SUMMARY, backendRequestId: "backend-create" }),
    moderate: async () => ({ data: SUMMARY, backendRequestId: "backend-moderate" }),
    ...overrides,
  };
}

function mutationRequest(body: unknown, overrides: Record<string, string> = {}) {
  return new Request("https://erp.example.com/api/upgrade-requests", {
    method: "POST",
    headers: {
      Origin: "https://erp.example.com",
      Cookie: `__Host-sj_web_session=${SESSION_TOKEN}; sj_csrf=${CSRF_TOKEN}`,
      "X-SJ-CSRF": CSRF_TOKEN,
      "Idempotency-Key": "upgrade-route-request-1",
      "Content-Type": "application/json",
      ...overrides,
    },
    body: JSON.stringify(body),
  });
}

test("upgrade BFF forwards opaque auth, idempotency, and contract data only", async () => {
  let forwarded: unknown;
  let credentials: string[] = [];
  const response = await handleUpgradeRequestCreate(mutationRequest({
    companyId: 1042,
    requestedTier: "Enterprise",
    message: SUMMARY.message,
  }), dependencies({
    create: async (input, sessionToken, idempotencyKey) => {
      forwarded = input;
      credentials = [sessionToken, idempotencyKey];
      return { data: SUMMARY, backendRequestId: "backend-create" };
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(forwarded, {
    companyId: 1042,
    requestedTier: "Enterprise",
    message: SUMMARY.message,
  });
  assert.deepEqual(credentials, [SESSION_TOKEN, "upgrade-route-request-1"]);
  assert.equal(JSON.stringify(await response.json()).includes(SESSION_TOKEN), false);
});

test("upgrade BFF fails closed at origin, CSRF, session, key, and body boundaries", async () => {
  let calls = 0;
  const deps = dependencies({
    create: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const payload = { companyId: 1042, requestedTier: "Enterprise", message: SUMMARY.message };
  const invalidOrigin = await handleUpgradeRequestCreate(mutationRequest(payload, {
    Origin: "https://attacker.example",
  }), deps);
  const invalidCsrf = await handleUpgradeRequestCreate(mutationRequest(payload, {
    "X-SJ-CSRF": "x".repeat(43),
  }), deps);
  const invalidSession = await handleUpgradeRequestCreate(mutationRequest(payload, {
    Cookie: `sj_csrf=${CSRF_TOKEN}`,
  }), deps);
  const invalidKey = await handleUpgradeRequestCreate(mutationRequest(payload, {
    "Idempotency-Key": "short",
  }), deps);
  const invalidBody = await handleUpgradeRequestCreate(mutationRequest({
    ...payload,
    currentTier: "Basic",
  }), deps);

  assert.deepEqual(
    [invalidOrigin.status, invalidCsrf.status, invalidSession.status, invalidKey.status, invalidBody.status],
    [403, 403, 401, 400, 400],
  );
  assert.equal(calls, 0);
});

test("upgrade moderation BFF preserves stale-version conflicts", async () => {
  const response = await handleUpgradeRequestModeration(
    mutationRequest({ status: "approved", entityVersion: "ev1.MQ" }),
    REQUEST_ID,
    dependencies({
      moderate: async () => {
        throw new BackendTransportError({
          status: 409,
          code: "STALE_ENTITY_VERSION",
          message: "The upgrade request changed.",
          requestId: "backend-stale",
          fieldErrors: { entityVersion: ["Reload and retry."] },
        });
      },
    }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "STALE_ENTITY_VERSION",
      message: "The upgrade request changed.",
      retryable: false,
      fieldErrors: { entityVersion: ["Reload and retry."] },
    },
    meta: { requestId: "backend-stale" },
  });
});
