import assert from "node:assert/strict";
import test from "node:test";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import { handleInvitationRedemption } from "../src/lib/onboarding/invitation-redemption-route-core.ts";

const sessionToken = "A".repeat(43);
const csrfToken = "B".repeat(43);
const origin = "http://localhost:3000";

function redemptionRequest(options: {
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
    headers.set("idempotency-key", options.idempotencyKey ?? "invite-redemption-key-1234");
  }
  return new Request(`${origin}/api/onboarding/invitation`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {
      companyId: 1001,
      inviteCode: "SJ-TEAM-2026",
      displayName: "Field Worker",
      phoneNumber: "+972500000000",
    }),
  });
}

test("invitation BFF forwards only opaque server auth and returns safe membership data", async () => {
  let calls = 0;
  const response = await handleInvitationRedemption(redemptionRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async redeem(input, token, key) {
      calls += 1;
      assert.equal(token, sessionToken);
      assert.equal(key, "invite-redemption-key-1234");
      assert.deepEqual(input, {
        companyId: 1001,
        inviteCode: "SJ-TEAM-2026",
        displayName: "Field Worker",
        phoneNumber: "+972500000000",
      });
      return {
        workspace: {
          companyId: 1001,
          name: "Acme Field Service",
          accountType: "business",
          role: "worker",
          memberNo: 7,
          enabledModules: ["clients", "inventory", "solojob"],
        },
        membership: {
          memberNo: 7,
          role: "worker",
          displayName: "Field Worker",
          status: "active",
          joinedAt: "2026-07-13T10:00:00.000Z",
        },
        requestId: "backend-invite-request",
      };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.workspace.companyId, 1001);
  assert.equal(body.meta.requestId, "backend-invite-request");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("invitation BFF fails closed for invalid origin, CSRF, session, key, or body", async () => {
  const cases = [
    [redemptionRequest({ origin: "https://attacker.invalid" }), 403, "MUTATION_BOUNDARY_INVALID"],
    [redemptionRequest({ csrfHeader: "C".repeat(43) }), 403, "MUTATION_BOUNDARY_INVALID"],
    [redemptionRequest({ session: null }), 401, "SESSION_REQUIRED"],
    [redemptionRequest({ idempotencyKey: null }), 400, "IDEMPOTENCY_KEY_REQUIRED"],
    [redemptionRequest({ body: { companyId: 0, inviteCode: "x" } }), 400, "VALIDATION_ERROR"],
  ] as const;

  for (const [request, status, code] of cases) {
    let calls = 0;
    const response = await handleInvitationRedemption(request, {
      websiteOrigin: origin,
      nodeEnv: "development",
      async redeem() {
        calls += 1;
        throw new Error("must not run");
      },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls, 0);
  }
});

test("invitation BFF preserves a validated backend conflict", async () => {
  const response = await handleInvitationRedemption(redemptionRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async redeem() {
      throw new BackendTransportError({
        status: 409,
        code: "INVITATION_UNAVAILABLE",
        message: "The invitation is no longer available.",
        requestId: "backend-conflict-request",
      });
    },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "INVITATION_UNAVAILABLE",
      message: "The invitation is no longer available.",
      retryable: false,
    },
    meta: { requestId: "backend-conflict-request" },
  });
});
