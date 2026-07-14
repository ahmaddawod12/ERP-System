import assert from "node:assert/strict";
import test from "node:test";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import { handleBusinessRegistration } from "../src/lib/onboarding/business-registration-route-core.ts";

const sessionToken = "A".repeat(43);
const csrfToken = "B".repeat(43);
const origin = "http://localhost:3000";

function registrationRequest(options: {
  origin?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  session?: string | null;
  idempotencyKey?: string | null;
  body?: unknown;
} = {}) {
  const cookies = [
    options.session === null
      ? null
      : `sj_web_session=${options.session ?? sessionToken}`,
    `sj_csrf=${options.csrfCookie ?? csrfToken}`,
  ].filter(Boolean).join("; ");
  const headers = new Headers({
    origin: options.origin ?? origin,
    cookie: cookies,
    "x-sj-csrf": options.csrfHeader ?? csrfToken,
    "content-type": "application/json",
  });
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? "registration-key-1234");
  }
  return new Request(`${origin}/api/onboarding/business-registration`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {
      workspaceMode: "solo",
      displayName: "Solo User",
      phoneNumber: "+972500000000",
    }),
  });
}

test("onboarding BFF forwards only opaque server auth and returns a safe result", async () => {
  let calls = 0;
  const response = await handleBusinessRegistration(registrationRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async register(input, token, key) {
      calls += 1;
      assert.deepEqual(input, {
        workspaceMode: "solo",
        displayName: "Solo User",
        phoneNumber: "+972500000000",
      });
      assert.equal(token, sessionToken);
      assert.equal(key, "registration-key-1234");
      return {
        workspace: {
          companyId: 1001,
          name: "Solo User",
          accountType: "solo",
          role: "user",
          memberNo: 1,
          enabledModules: ["clients", "documents", "inventory", "solojob"],
        },
        tier: "Solo",
        requestId: "backend-registration-request",
      };
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.workspace.companyId, 1001);
  assert.equal(body.meta.requestId, "backend-registration-request");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("onboarding BFF fails closed before forwarding invalid origin or CSRF", async () => {
  for (const request of [
    registrationRequest({ origin: "https://attacker.invalid" }),
    registrationRequest({ csrfHeader: "C".repeat(43) }),
  ]) {
    let calls = 0;
    const response = await handleBusinessRegistration(request, {
      websiteOrigin: origin,
      nodeEnv: "development",
      async register() {
        calls += 1;
        throw new Error("must not run");
      },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "MUTATION_BOUNDARY_INVALID");
    assert.equal(calls, 0);
  }
});

test("onboarding BFF requires a valid session, idempotency key, and contract body", async () => {
  const cases = [
    [registrationRequest({ session: null }), 401, "SESSION_REQUIRED"],
    [registrationRequest({ idempotencyKey: null }), 400, "IDEMPOTENCY_KEY_REQUIRED"],
    [registrationRequest({ body: { workspaceMode: "business" } }), 400, "VALIDATION_ERROR"],
  ] as const;
  for (const [request, status, code] of cases) {
    const response = await handleBusinessRegistration(request, {
      websiteOrigin: origin,
      nodeEnv: "development",
      async register() {
        throw new Error("must not run");
      },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("onboarding BFF preserves validated backend conflicts without leaking details", async () => {
  const response = await handleBusinessRegistration(registrationRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async register() {
      throw new BackendTransportError({
        status: 409,
        code: "ONBOARDING_ALREADY_COMPLETED",
        message: "This account already belongs to a workspace.",
        requestId: "backend-conflict-request",
      });
    },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "ONBOARDING_ALREADY_COMPLETED",
      message: "This account already belongs to a workspace.",
      retryable: false,
    },
    meta: { requestId: "backend-conflict-request" },
  });
});
