import assert from "node:assert/strict";
import test from "node:test";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import { handleInvitationCreate } from "../src/lib/workers/invitation-create-route-core.ts";

const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const origin = "http://localhost:3000";

function invitationRequest(options: {
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
    headers.set("idempotency-key", options.idempotencyKey ?? "invitation-create-key-1234");
  }
  return new Request(`${origin}/api/workers/invitation`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {
      companyId: 1001,
      invitation: {
        targetRole: "worker",
        targetEmail: "technician@example.test",
        expiresInDays: 30,
      },
    }),
  });
}

test("invitation creation BFF forwards only opaque server auth and safe input", async () => {
  let calls = 0;
  const response = await handleInvitationCreate(invitationRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async create(companyId, input, token, key) {
      calls += 1;
      assert.equal(companyId, 1001);
      assert.equal(token, sessionToken);
      assert.equal(key, "invitation-create-key-1234");
      assert.deepEqual(input, {
        targetRole: "worker",
        targetEmail: "technician@example.test",
        expiresInDays: 30,
      });
      return {
        inviteId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
        inviteCode: "A1B2C3D4E5F6",
        targetRole: "worker",
        status: "active",
        expiresAt: "2026-08-12T12:00:00.000Z",
        createdAt: "2026-07-13T12:00:00.000Z",
        requestId: "backend-invitation-create",
      };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.inviteCode, "A1B2C3D4E5F6");
  assert.equal(body.meta.requestId, "backend-invitation-create");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("invitation creation BFF fails closed at every browser mutation boundary", async () => {
  const cases = [
    [invitationRequest({ origin: "https://attacker.invalid" }), 403, "MUTATION_BOUNDARY_INVALID"],
    [invitationRequest({ csrfHeader: "D".repeat(43) }), 403, "MUTATION_BOUNDARY_INVALID"],
    [invitationRequest({ session: null }), 401, "SESSION_REQUIRED"],
    [invitationRequest({ idempotencyKey: null }), 400, "IDEMPOTENCY_KEY_REQUIRED"],
    [invitationRequest({ body: { companyId: 0, invitation: { targetRole: "dev" } } }), 400, "VALIDATION_ERROR"],
  ] as const;

  for (const [request, status, code] of cases) {
    let calls = 0;
    const response = await handleInvitationCreate(request, {
      websiteOrigin: origin,
      nodeEnv: "development",
      async create() {
        calls += 1;
        throw new Error("must not run");
      },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls, 0);
  }
});

test("invitation creation BFF preserves validated backend throttling", async () => {
  const response = await handleInvitationCreate(invitationRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async create() {
      throw new BackendTransportError({
        status: 429,
        code: "INVITATION_RATE_LIMITED",
        message: "Too many invitations were created. Try again later.",
        retryable: true,
        requestId: "backend-rate-limit",
      });
    },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "INVITATION_RATE_LIMITED",
      message: "Too many invitations were created. Try again later.",
      retryable: true,
    },
    meta: { requestId: "backend-rate-limit" },
  });
});
