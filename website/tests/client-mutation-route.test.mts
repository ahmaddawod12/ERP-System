import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientDeleteResultSchema,
  ClientSummarySchema,
} from "@smart-job/api-contracts";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleClientCreate,
  handleClientDelete,
  handleClientUpdate,
} from "../src/lib/clients/client-mutation-route-core.ts";
import {
  clientMutationKey,
  type PendingClientMutation,
} from "../src/components/clients/client-mutation-model.ts";

const origin = "http://localhost:3000";
const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const companyId = "42";
const clientId = "11111111-1111-4111-8111-111111111111";
const entityVersion = "ev1.MQ";

const client = ClientSummarySchema.parse({
  clientId,
  clientNo: 7,
  status: "active",
  name: "Northwind Cooling",
  phone: "+972500000000",
  email: "dispatch@northwind.example",
  address: "1 Harbor Road",
  city: "Haifa",
  vatNumber: "515987654",
  notes: null,
  entityVersion,
  createdAt: "2026-07-13T08:00:00.000Z",
  updatedAt: "2026-07-13T08:00:00.000Z",
  archivedAt: null,
});

interface RequestOptions {
  readonly origin?: string;
  readonly csrfCookie?: string;
  readonly csrfHeader?: string;
  readonly session?: string | null;
  readonly idempotencyKey?: string | null;
}

function mutationRequest(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  options: RequestOptions = {},
) {
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
    headers.set("idempotency-key", options.idempotencyKey ?? "client-mutation-key-1234");
  }
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

test("browser client retries keep one idempotency key until completion", () => {
  const pending: { current: PendingClientMutation | null } = { current: null };
  const first = clientMutationKey(pending, "same-request");
  assert.equal(clientMutationKey(pending, "same-request"), first);
  const changed = clientMutationKey(pending, "changed-request");
  assert.notEqual(changed, first);
  pending.current = null;
  assert.notEqual(clientMutationKey(pending, "changed-request"), changed);
});

test("client create BFF enforces the browser boundary and forwards opaque auth only", async () => {
  let calls = 0;
  const response = await handleClientCreate(
    mutationRequest("/api/companies/42/clients", "POST", {
      name: " Northwind Cooling ",
      email: " DISPATCH@northwind.example ",
      phone: null,
    }),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async create(resolvedCompanyId, input, token, key) {
        calls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(token, sessionToken);
        assert.equal(key, "client-mutation-key-1234");
        assert.deepEqual(input, {
          name: "Northwind Cooling",
          email: "dispatch@northwind.example",
          phone: null,
        });
        return { data: client, backendRequestId: "backend-client-create" };
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.entityVersion, entityVersion);
  assert.equal(body.meta.requestId, "backend-client-create");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("client update and removal preserve tenant scope, entity versions, and outcomes", async () => {
  let updateCalls = 0;
  const updatedResponse = await handleClientUpdate(
    mutationRequest(`/api/companies/42/clients/${clientId}`, "PATCH", {
      entityVersion,
      name: "Northwind Cooling Ltd.",
      notes: null,
    }),
    companyId,
    clientId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update(resolvedCompanyId, resolvedClientId, input, token, key) {
        updateCalls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(resolvedClientId, clientId);
        assert.equal(input.entityVersion, entityVersion);
        assert.equal(token, sessionToken);
        assert.equal(key, "client-mutation-key-1234");
        return {
          data: ClientSummarySchema.parse({
            ...client,
            name: "Northwind Cooling Ltd.",
            entityVersion: "ev1.Mg",
          }),
          backendRequestId: "backend-client-update",
        };
      },
    },
  );
  assert.equal(updatedResponse.status, 200);
  assert.equal(updateCalls, 1);
  assert.equal((await updatedResponse.json()).data.entityVersion, "ev1.Mg");

  const removal = ClientDeleteResultSchema.parse({
    clientId,
    clientNo: 7,
    disposition: "archived",
    entityVersion: "ev1.Mw",
    archivedAt: "2026-07-13T09:00:00.000Z",
  });
  let removeCalls = 0;
  const removedResponse = await handleClientDelete(
    mutationRequest(`/api/companies/42/clients/${clientId}`, "DELETE", {
      entityVersion: "ev1.Mg",
    }),
    companyId,
    clientId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async remove(resolvedCompanyId, resolvedClientId, input, token, key) {
        removeCalls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(resolvedClientId, clientId);
        assert.equal(input.entityVersion, "ev1.Mg");
        assert.equal(token, sessionToken);
        assert.equal(key, "client-mutation-key-1234");
        return { data: removal, backendRequestId: "backend-client-remove" };
      },
    },
  );
  assert.equal(removedResponse.status, 200);
  assert.equal(removeCalls, 1);
  assert.deepEqual((await removedResponse.json()).data, removal);
});

test("client BFFs fail closed before invoking backend mutations", async () => {
  const cases = [
    [
      () => handleClientCreate(
        mutationRequest("/api/companies/42/clients", "POST", { name: "Client" }, {
          origin: "https://attacker.invalid",
        }),
        companyId,
        createDependencies(),
      ),
      403,
      "MUTATION_BOUNDARY_INVALID",
    ],
    [
      () => handleClientCreate(
        mutationRequest("/api/companies/42/clients", "POST", { name: "Client" }, {
          csrfHeader: "D".repeat(43),
        }),
        companyId,
        createDependencies(),
      ),
      403,
      "MUTATION_BOUNDARY_INVALID",
    ],
    [
      () => handleClientCreate(
        mutationRequest("/api/companies/42/clients", "POST", { name: "Client" }, {
          session: null,
        }),
        companyId,
        createDependencies(),
      ),
      401,
      "SESSION_REQUIRED",
    ],
    [
      () => handleClientCreate(
        mutationRequest("/api/companies/42/clients", "POST", { name: "Client" }, {
          idempotencyKey: null,
        }),
        companyId,
        createDependencies(),
      ),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    ],
    [
      () => handleClientCreate(
        mutationRequest("/api/companies/not-a-company/clients", "POST", { name: "Client" }),
        "not-a-company",
        createDependencies(),
      ),
      400,
      "VALIDATION_ERROR",
    ],
    [
      () => handleClientUpdate(
        mutationRequest("/api/companies/42/clients/not-a-client", "PATCH", {
          entityVersion,
          name: "Client",
        }),
        companyId,
        "not-a-client",
        updateDependencies(),
      ),
      400,
      "VALIDATION_ERROR",
    ],
  ] as const;

  for (const [run, status, code] of cases) {
    const response = await run();
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("client BFF preserves optimistic-concurrency conflicts", async () => {
  const response = await handleClientUpdate(
    mutationRequest(`/api/companies/42/clients/${clientId}`, "PATCH", {
      entityVersion,
      name: "Changed client",
    }),
    companyId,
    clientId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update() {
        throw new BackendTransportError({
          status: 409,
          code: "STALE_ENTITY_VERSION",
          message: "The client changed before this request was applied.",
          requestId: "backend-client-conflict",
          fieldErrors: { entityVersion: ["Reload the client and try again."] },
        });
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "STALE_ENTITY_VERSION",
      message: "The client changed before this request was applied.",
      retryable: false,
      fieldErrors: { entityVersion: ["Reload the client and try again."] },
    },
    meta: { requestId: "backend-client-conflict" },
  });
});

test("client BFF rejects a mismatched backend client identity", async () => {
  const response = await handleClientUpdate(
    mutationRequest(`/api/companies/42/clients/${clientId}`, "PATCH", {
      entityVersion,
      name: "Changed client",
    }),
    companyId,
    clientId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update() {
        return {
          data: { ...client, clientId: "22222222-2222-4222-8222-222222222222" },
          backendRequestId: "backend-mismatch",
        };
      },
    },
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
});

function createDependencies() {
  return {
    websiteOrigin: origin,
    nodeEnv: "development",
    async create(): Promise<never> {
      throw new Error("backend must not run");
    },
  } as const;
}

function updateDependencies() {
  return {
    websiteOrigin: origin,
    nodeEnv: "development",
    async update(): Promise<never> {
      throw new Error("backend must not run");
    },
  } as const;
}
