import assert from "node:assert/strict";
import test from "node:test";
import { InventoryPartSummarySchema } from "@smart-job/api-contracts";

import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleInventoryAdjustment,
  handleInventoryPartArchive,
  handleInventoryPartCreate,
  handleInventoryPartUpdate,
} from "../src/lib/inventory/inventory-mutation-route-core.ts";
import {
  inventoryMutationKey,
  type PendingInventoryMutation,
} from "../src/components/inventory/inventory-mutation-model.ts";

const origin = "http://localhost:3000";
const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const companyId = "42";
const partId = "11111111-1111-4111-8111-111111111111";
const entityVersion = "ev1.MQ";
const stockEntityVersion = "ev1.Mg";

const part = InventoryPartSummarySchema.parse({
  partId,
  partNo: 12,
  status: "active",
  name: "Compressor relay",
  active: true,
  quantity: 8,
  lowThreshold: 2,
  unit: "piece",
  entityVersion,
  stockEntityVersion,
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
    headers.set("idempotency-key", options.idempotencyKey ?? "inventory-mutation-key-1234");
  }
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

test("browser inventory retries keep one idempotency key until completion", () => {
  const pending: { current: PendingInventoryMutation | null } = { current: null };
  const first = inventoryMutationKey(pending, "same-request");
  assert.equal(inventoryMutationKey(pending, "same-request"), first);
  const changed = inventoryMutationKey(pending, "changed-request");
  assert.notEqual(changed, first);
  pending.current = null;
  assert.notEqual(inventoryMutationKey(pending, "changed-request"), changed);
});

test("inventory create BFF enforces the browser boundary and forwards opaque auth only", async () => {
  let calls = 0;
  const response = await handleInventoryPartCreate(
    mutationRequest("/api/companies/42/inventory/parts", "POST", {
      name: " Compressor relay ",
      initialQuantity: 8,
      lowThreshold: 2,
      unit: " piece ",
    }),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async create(resolvedCompanyId, input, token, key) {
        calls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(token, sessionToken);
        assert.equal(key, "inventory-mutation-key-1234");
        assert.deepEqual(input, {
          name: "Compressor relay",
          initialQuantity: 8,
          lowThreshold: 2,
          unit: "piece",
        });
        return { data: part, backendRequestId: "backend-inventory-create" };
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.entityVersion, entityVersion);
  assert.equal(body.data.stockEntityVersion, stockEntityVersion);
  assert.equal(body.meta.requestId, "backend-inventory-create");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});

test("inventory update, adjustment, and archive preserve both opaque versions", async () => {
  const updatedResponse = await handleInventoryPartUpdate(
    mutationRequest(`/api/companies/42/inventory/parts/${partId}`, "PATCH", {
      entityVersion,
      name: "Relay",
      lowThreshold: 3,
      unit: "piece",
      active: true,
    }),
    companyId,
    partId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update(resolvedCompanyId, resolvedPartId, input, token, key) {
        assert.equal(resolvedCompanyId, 42);
        assert.equal(resolvedPartId, partId);
        assert.equal(input.entityVersion, entityVersion);
        assert.equal(token, sessionToken);
        assert.equal(key, "inventory-mutation-key-1234");
        return {
          data: InventoryPartSummarySchema.parse({
            ...part,
            name: "Relay",
            lowThreshold: 3,
            entityVersion: "ev1.Mw",
          }),
          backendRequestId: "backend-inventory-update",
        };
      },
    },
  );
  const updated = await updatedResponse.json();
  assert.equal(updated.data.entityVersion, "ev1.Mw");
  assert.equal(updated.data.stockEntityVersion, stockEntityVersion);

  const adjustmentResponse = await handleInventoryAdjustment(
    mutationRequest(`/api/companies/42/inventory/parts/${partId}/adjustments`, "POST", {
      stockEntityVersion,
      quantityDelta: -2,
      note: "Used for a repair",
    }),
    companyId,
    partId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async adjust(_resolvedCompanyId, _resolvedPartId, input) {
        assert.equal(input.stockEntityVersion, stockEntityVersion);
        assert.equal(input.quantityDelta, -2);
        return {
          data: InventoryPartSummarySchema.parse({
            ...part,
            quantity: 6,
            stockEntityVersion: "ev1.NA",
          }),
          backendRequestId: "backend-inventory-adjust",
        };
      },
    },
  );
  const adjusted = await adjustmentResponse.json();
  assert.equal(adjusted.data.quantity, 6);
  assert.equal(adjusted.data.stockEntityVersion, "ev1.NA");

  const archiveResponse = await handleInventoryPartArchive(
    mutationRequest(`/api/companies/42/inventory/parts/${partId}`, "DELETE", {
      entityVersion: "ev1.Mw",
    }),
    companyId,
    partId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async archive(_resolvedCompanyId, _resolvedPartId, input) {
        assert.equal(input.entityVersion, "ev1.Mw");
        return {
          data: InventoryPartSummarySchema.parse({
            ...part,
            status: "archived",
            active: false,
            quantity: 0,
            entityVersion: "ev1.NQ",
            archivedAt: "2026-07-13T10:00:00.000Z",
          }),
          backendRequestId: "backend-inventory-archive",
        };
      },
    },
  );
  assert.equal((await archiveResponse.json()).data.status, "archived");
});

test("inventory BFFs fail closed before invoking backend mutations", async () => {
  const cases = [
    [
      () => handleInventoryPartCreate(
        mutationRequest("/api/companies/42/inventory/parts", "POST", { name: "Part" }, {
          origin: "https://attacker.invalid",
        }),
        companyId,
        createDependencies(),
      ),
      403,
      "MUTATION_BOUNDARY_INVALID",
    ],
    [
      () => handleInventoryPartCreate(
        mutationRequest("/api/companies/42/inventory/parts", "POST", { name: "Part" }, {
          csrfHeader: "D".repeat(43),
        }),
        companyId,
        createDependencies(),
      ),
      403,
      "MUTATION_BOUNDARY_INVALID",
    ],
    [
      () => handleInventoryPartCreate(
        mutationRequest("/api/companies/42/inventory/parts", "POST", { name: "Part" }, {
          session: null,
        }),
        companyId,
        createDependencies(),
      ),
      401,
      "SESSION_REQUIRED",
    ],
    [
      () => handleInventoryPartCreate(
        mutationRequest("/api/companies/42/inventory/parts", "POST", { name: "Part" }, {
          idempotencyKey: null,
        }),
        companyId,
        createDependencies(),
      ),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    ],
    [
      () => handleInventoryPartCreate(
        mutationRequest("/api/companies/not-a-company/inventory/parts", "POST", { name: "Part" }),
        "not-a-company",
        createDependencies(),
      ),
      400,
      "VALIDATION_ERROR",
    ],
    [
      () => handleInventoryPartUpdate(
        mutationRequest("/api/companies/42/inventory/parts/not-a-part", "PATCH", {
          entityVersion,
          name: "Part",
        }),
        companyId,
        "not-a-part",
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

test("inventory BFF preserves stock concurrency conflicts and rejects mismatched parts", async () => {
  const conflict = await handleInventoryAdjustment(
    mutationRequest(`/api/companies/42/inventory/parts/${partId}/adjustments`, "POST", {
      stockEntityVersion,
      quantityDelta: 1,
    }),
    companyId,
    partId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async adjust() {
        throw new BackendTransportError({
          status: 409,
          code: "STALE_ENTITY_VERSION",
          message: "The inventory changed before this request was applied.",
          requestId: "backend-inventory-conflict",
          fieldErrors: { stockEntityVersion: ["Reload inventory and try again."] },
        });
      },
    },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.fieldErrors.stockEntityVersion[0], "Reload inventory and try again.");

  const mismatch = await handleInventoryPartUpdate(
    mutationRequest(`/api/companies/42/inventory/parts/${partId}`, "PATCH", {
      entityVersion,
      name: "Part",
    }),
    companyId,
    partId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async update() {
        return {
          data: { ...part, partId: "22222222-2222-4222-8222-222222222222" },
          backendRequestId: "backend-mismatch",
        };
      },
    },
  );
  assert.equal(mismatch.status, 500);
  assert.equal((await mismatch.json()).error.code, "INTERNAL_ERROR");
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
