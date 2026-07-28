import assert from "node:assert/strict";
import test from "node:test";
import { BusinessProfileSchema } from "@smart-job/api-contracts";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleCompanyProfileUpdate,
  handleViewerProfileUpdate,
} from "../src/lib/settings/profile-route-core.ts";

const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const origin = "http://localhost:3000";

interface RequestOptions {
  readonly origin?: string;
  readonly csrfCookie?: string;
  readonly csrfHeader?: string;
  readonly session?: string | null;
  readonly idempotencyKey?: string | null;
  readonly body?: unknown;
}

function mutationRequest(path: string, defaultBody: unknown, options: RequestOptions = {}) {
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
    headers.set("idempotency-key", options.idempotencyKey ?? "profile-update-key-1234");
  }
  return new Request(`${origin}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(options.body ?? defaultBody),
  });
}

function viewerRequest(options: RequestOptions = {}) {
  return mutationRequest("/api/settings/profile", {
    companyId: 42,
    displayName: "Updated Manager",
    phoneNumber: null,
  }, options);
}

function companyRequest(options: RequestOptions = {}) {
  return mutationRequest("/api/settings/company-profile", {
    companyId: 42,
    profile: {
      entityVersion: "ev1.MQ",
      enName: "Updated Company",
      city: "Jerusalem",
    },
  }, options);
}

function viewerProfile() {
  return {
    uid: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    email: "manager@example.test",
    displayName: "Updated Manager",
    phoneNumber: null,
    systemRole: null,
    companyId: 42,
    updatedAt: "2026-07-13T12:00:00.000Z",
    requestId: "backend-viewer-profile-update",
  } as const;
}

function businessProfile() {
  const profile = BusinessProfileSchema.parse({
    companyId: 42,
    heName: "Test Company",
    enName: "Updated Company",
    vatNumber: "123456789",
    businessType: "Field service",
    city: "Jerusalem",
    address: "1 Test Road",
    businessEmail: "office@example.test",
    businessPhone: "+972500000000",
    businessFax: null,
    accountantName: null,
    accountantEmail: null,
    accountantPhone: null,
    entityVersion: "ev1.Mg",
    updatedAt: "2026-07-13T12:00:00.000Z",
  });
  return { ...profile, requestId: "backend-company-profile-update" };
}

test("viewer profile BFF forwards only opaque server auth and validated profile fields", async () => {
  let calls = 0;
  const response = await handleViewerProfileUpdate(viewerRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update(input, token, key) {
      calls += 1;
      assert.equal(token, sessionToken);
      assert.equal(key, "profile-update-key-1234");
      assert.deepEqual(input, {
        companyId: 42,
        displayName: "Updated Manager",
        phoneNumber: null,
      });
      return viewerProfile();
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.companyId, 42);
  assert.equal(body.meta.requestId, "backend-viewer-profile-update");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("company profile BFF forwards entity version and never accepts VAT authority", async () => {
  let calls = 0;
  const response = await handleCompanyProfileUpdate(companyRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update(companyId, input, token, key) {
      calls += 1;
      assert.equal(companyId, 42);
      assert.equal(token, sessionToken);
      assert.equal(key, "profile-update-key-1234");
      assert.deepEqual(input, {
        entityVersion: "ev1.MQ",
        enName: "Updated Company",
        city: "Jerusalem",
      });
      assert.equal("vatNumber" in input, false);
      return businessProfile();
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal((await response.json()).data.entityVersion, "ev1.Mg");

  const rejected = await handleCompanyProfileUpdate(companyRequest({
    body: {
      companyId: 42,
      profile: { entityVersion: "ev1.MQ", vatNumber: "999999999" },
    },
  }), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update() {
      calls += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "VALIDATION_ERROR");
  assert.equal(calls, 1);
});

test("profile BFFs fail closed at every browser mutation boundary", async () => {
  const cases = [
    [viewerRequest({ origin: "https://attacker.invalid" }), 403, "MUTATION_BOUNDARY_INVALID"],
    [viewerRequest({ csrfHeader: "D".repeat(43) }), 403, "MUTATION_BOUNDARY_INVALID"],
    [viewerRequest({ session: null }), 401, "SESSION_REQUIRED"],
    [viewerRequest({ idempotencyKey: null }), 400, "IDEMPOTENCY_KEY_REQUIRED"],
    [viewerRequest({ body: { displayName: "Missing workspace" } }), 400, "VALIDATION_ERROR"],
  ] as const;

  for (const [request, status, code] of cases) {
    let calls = 0;
    const response = await handleViewerProfileUpdate(request, {
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

test("company profile BFF preserves a validated optimistic-concurrency conflict", async () => {
  const response = await handleCompanyProfileUpdate(companyRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update() {
      throw new BackendTransportError({
        status: 409,
        code: "STALE_ENTITY_VERSION",
        message: "The company profile changed before this request was applied.",
        requestId: "backend-profile-conflict",
        fieldErrors: { entityVersion: ["Reload the company profile and try again."] },
      });
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "STALE_ENTITY_VERSION",
      message: "The company profile changed before this request was applied.",
      retryable: false,
      fieldErrors: { entityVersion: ["Reload the company profile and try again."] },
    },
    meta: { requestId: "backend-profile-conflict" },
  });
});

test("profile BFF runtime validation rejects a mismatched backend tenant", async () => {
  const response = await handleCompanyProfileUpdate(companyRequest(), {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update() {
      return { ...businessProfile(), companyId: 7 };
    },
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
});
