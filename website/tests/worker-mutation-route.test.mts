import assert from "node:assert/strict";
import test from "node:test";
import { WorkerSummarySchema } from "@smart-job/api-contracts";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleWorkerDisable,
  handleWorkerUpdate,
} from "../src/lib/workers/worker-mutation-route-core.ts";

const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const origin = "http://localhost:3000";

function workerRequest(method: "PATCH" | "DELETE", options: {
  origin?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  session?: string | null;
  idempotencyKey?: string | null;
  body?: unknown;
} = {}) {
  const cookies = [
    options.session === null ? null : `sj_web_session=${options.session ?? sessionToken}`,
    `sj_csrf=${options.csrfCookie ?? csrfToken}`,
  ].filter(Boolean).join("; ");
  const headers = new Headers({
    origin: options.origin ?? origin,
    cookie: cookies,
    "x-sj-csrf": options.csrfHeader ?? csrfToken,
    "content-type": "application/json",
  });
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? "worker-membership-key-1234");
  }
  return new Request(`${origin}/api/workers/membership`, {
    method,
    headers,
    body: JSON.stringify(options.body ?? (method === "PATCH" ? {
      companyId: 1001,
      memberNo: 17,
      worker: {
        entityVersion: "ev1.MQ",
        displayName: "Lead technician",
        phoneNumber: null,
        role: "user",
      },
    } : {
      companyId: 1001,
      memberNo: 17,
      entityVersion: "ev1.Mg",
    })),
  });
}

function updatedWorker(overrides: Record<string, unknown> = {}) {
  const { requestId, ...worker } = {
    memberNo: 17,
    role: "user" as const,
    status: "active" as const,
    displayName: "Lead technician",
    email: "technician@example.test",
    phoneNumber: null,
    entityVersion: "ev1.Mg" as const,
    joinedAt: "2026-07-13T10:00:00.000Z",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    requestId: "backend-worker-mutation",
    ...overrides,
  };
  return {
    ...WorkerSummarySchema.parse(worker),
    requestId: String(requestId),
  };
}

test("worker update BFF forwards only opaque server auth and validated membership input", async () => {
  let calls = 0;
  const response = await handleWorkerUpdate(workerRequest("PATCH"), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update(companyId, memberNo, input, token, key) {
      calls += 1;
      assert.equal(companyId, 1001);
      assert.equal(memberNo, 17);
      assert.equal(token, sessionToken);
      assert.equal(key, "worker-membership-key-1234");
      assert.deepEqual(input, {
        entityVersion: "ev1.MQ",
        displayName: "Lead technician",
        phoneNumber: null,
        role: "user",
      });
      return updatedWorker();
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.entityVersion, "ev1.Mg");
  assert.equal(body.meta.requestId, "backend-worker-mutation");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
});

test("worker disable BFF forwards an opaque version and preserves lifecycle conflicts", async () => {
  const success = await handleWorkerDisable(workerRequest("DELETE"), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async disable(companyId, memberNo, version, token, key) {
      assert.deepEqual([companyId, memberNo, version, token, key], [
        1001,
        17,
        "ev1.Mg",
        sessionToken,
        "worker-membership-key-1234",
      ]);
      return updatedWorker({
        status: "disabled",
        entityVersion: "ev1.Mw",
      });
    },
  });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).data.status, "disabled");

  const blocked = await handleWorkerDisable(workerRequest("DELETE"), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async disable() {
      throw new BackendTransportError({
        status: 409,
        code: "WORKER_HAS_ACTIVE_JOBS",
        message: "Reassign active jobs first.",
        retryable: false,
        requestId: "backend-worker-conflict",
      });
    },
  });
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), {
    ok: false,
    error: {
      code: "WORKER_HAS_ACTIVE_JOBS",
      message: "Reassign active jobs first.",
      retryable: false,
    },
    meta: { requestId: "backend-worker-conflict" },
  });
});

test("worker mutation BFF fails closed at every browser boundary", async () => {
  const cases = [
    [workerRequest("PATCH", { origin: "https://attacker.invalid" }), 403, "MUTATION_BOUNDARY_INVALID"],
    [workerRequest("PATCH", { csrfHeader: "D".repeat(43) }), 403, "MUTATION_BOUNDARY_INVALID"],
    [workerRequest("PATCH", { session: null }), 401, "SESSION_REQUIRED"],
    [workerRequest("PATCH", { idempotencyKey: null }), 400, "IDEMPOTENCY_KEY_REQUIRED"],
    [workerRequest("PATCH", { body: { companyId: 0, memberNo: -1, worker: {} } }), 400, "VALIDATION_ERROR"],
  ] as const;

  for (const [request, status, code] of cases) {
    let calls = 0;
    const response = await handleWorkerUpdate(request, {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update() {
        calls += 1;
        throw new Error("must not run");
      },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls, 0);
  }
});
