import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import {
  ADJUST_INVENTORY_STOCK_SQL,
  CREATE_INVENTORY_PART_SQL,
  PICK_INVENTORY_STOCK_SQL,
  TRANSFER_INVENTORY_STOCK_SQL,
  UPDATE_INVENTORY_PART_SQL,
} from "../inventory/mutation-repository.js";
import { registerInventoryMutationRoutes } from "../routes/inventory-mutations.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const internalCompanyId = "26963503-982a-4552-97d0-45b5fdbfbda9";
const partId = "9b4f0638-e356-4f78-8981-e94a5c9a484c";
const movementId = "604f018a-06fd-4f7c-902f-0e05df886cc9";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function partRow(entityVersion: string, stockVersion: string, quantity = "10.000") {
  return {
    part_id: partId,
    part_no: 12,
    status: "active",
    name: "Compressor relay",
    active: true,
    quantity_on_hand: quantity,
    low_threshold: "2.000",
    unit: "piece",
    entity_version: entityVersion,
    stock_entity_version: stockVersion,
    created_at: new Date("2026-07-13T12:00:00.000Z"),
    updated_at: new Date("2026-07-13T12:00:00.000Z"),
    archived_at: null,
  };
}

function movementRow(sourceVersion: string, destinationVersion: string) {
  return {
    movement_id: movementId,
    part_id: partId,
    part_no: 12,
    quantity: "2.000",
    source_quantity: "8.000",
    source_stock_entity_version: sourceVersion,
    destination_quantity: "2.000",
    destination_stock_entity_version: destinationVersion,
  };
}

test("inventory mutations normalize tenants, require verification/idempotency, and replay once", async (context) => {
  const claims = new Map<string, {
    requestHash: Buffer;
    responseStatus: number | null;
    responseBody: unknown;
    completedAt: Date | null;
  }>();
  const calls: Record<string, number> = {};
  let verifiedLookups = 0;

  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        assert.deepEqual(values, [userId, 77]);
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Inventory Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { inventory: true },
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        const operation = String(values?.[2]);
        if (!claims.has(operation)) {
          claims.set(operation, {
            requestHash: values?.[4] as Buffer,
            responseStatus: null,
            responseBody: null,
            completedAt: null,
          });
        }
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        const operation = String(values?.[2]);
        const claim = claims.get(operation);
        assert.ok(claim);
        return result<Row>([{
          id: `claim-${operation}`,
          request_hash: claim.requestHash,
          response_status: claim.responseStatus,
          response_body: claim.responseBody,
          completed_at: claim.completedAt,
          expires_at: new Date(Date.now() + 60_000),
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        const operation = String(values?.[0]).replace(/^claim-/u, "");
        const claim = claims.get(operation);
        assert.ok(claim);
        claim.responseStatus = Number(values?.[1]);
        claim.responseBody = JSON.parse(String(values?.[2]));
        claim.completedAt = new Date();
        return { rowCount: 1, rows: [] as Row[] };
      }

      const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
      if (text === CREATE_INVENTORY_PART_SQL) {
        count("create");
        assert.equal(values?.[0], internalCompanyId);
        assert.deepEqual(JSON.parse(String(values?.[1])), {
          name: "Compressor relay",
          initialQuantity: 10,
          lowThreshold: 2,
          unit: "piece",
        });
        return result<Row>([partRow("1", "2")]);
      }
      if (text === UPDATE_INVENTORY_PART_SQL) {
        count("update");
        assert.equal(values?.[2], "1");
        assert.deepEqual(JSON.parse(String(values?.[3])), { name: "Relay v2" });
        return result<Row>([{
          ...partRow("2", "2"),
          name: "Relay v2",
        }]);
      }
      if (text === ADJUST_INVENTORY_STOCK_SQL) {
        const scope = String(values?.[2]);
        count(`adjust-${scope}`);
        assert.equal(values?.[3], "2");
        assert.equal(values?.[4], -1);
        return result<Row>([partRow("2", "3", "9.000")]);
      }
      if (text === TRANSFER_INVENTORY_STOCK_SQL) {
        count("transfer");
        assert.deepEqual(values?.slice(0, 7), [
          internalCompanyId,
          partId,
          7,
          "company_to_member",
          2,
          "3",
          null,
        ]);
        return result<Row>([movementRow("4", "2")]);
      }
      if (text === PICK_INVENTORY_STOCK_SQL) {
        count("pick");
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], 7);
        assert.deepEqual(JSON.parse(String(values?.[2])), [{
          partId,
          quantity: 2,
          expectedStockEntityVersion: "4",
        }]);
        return result<Row>([movementRow("5", "3")]);
      }
      throw new Error(`Unexpected SQL in inventory test: ${text.slice(0, 100)}`);
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(transactionContext, work) {
      assert.equal(transactionContext.userId, userId);
      return work(transaction);
    },
  };
  const authenticator: ApiRequestAuthenticator = {
    async authenticate() {
      return {
        scheme: "bearer",
        userId,
        expiresAt: 4_102_444_800,
        accessToken: "inventory.payload.signature",
      };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInventoryMutationRoutes(app, {
    authenticator,
    database,
    supabaseUsers: {
      async getUser() {
        verifiedLookups += 1;
        return { userId, email: "manager@example.test", emailVerified: true };
      },
    },
  });

  const createRequest = {
    method: "POST" as const,
    url: "/api/v1/companies/77/inventory/parts",
    headers: { "idempotency-key": "inventory-create-key" },
    payload: {
      name: " Compressor relay ",
      initialQuantity: 10,
      lowThreshold: 2,
      unit: " piece ",
    },
  };
  const created = await app.inject(createRequest);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().data.entityVersion, encodeEntityVersion(1));
  assert.equal(created.json().data.stockEntityVersion, encodeEntityVersion(2));
  const replayed = await app.inject(createRequest);
  assert.equal(replayed.statusCode, 201, replayed.body);
  assert.deepEqual(replayed.json().data, created.json().data);
  assert.equal(calls.create, 1);

  const updated = await app.inject({
    method: "PATCH",
    url: `/api/v1/companies/77/inventory/parts/${partId}`,
    headers: { "idempotency-key": "inventory-update-key" },
    payload: { entityVersion: encodeEntityVersion(1), name: " Relay v2 " },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.entityVersion, encodeEntityVersion(2));

  for (const scope of ["company", "member"] as const) {
    const suffix = scope === "company" ? "" : "/me";
    const adjusted = await app.inject({
      method: "POST",
      url: `/api/v1/companies/77/inventory${suffix}/parts/${partId}/adjustments`,
      headers: { "idempotency-key": `inventory-adjust-${scope}` },
      payload: { stockEntityVersion: encodeEntityVersion(2), quantityDelta: -1 },
    });
    assert.equal(adjusted.statusCode, 200, adjusted.body);
    assert.equal(adjusted.json().data.quantity, 9);
  }

  const transferred = await app.inject({
    method: "POST",
    url: "/api/v1/companies/77/inventory/transfers",
    headers: { "idempotency-key": "inventory-transfer-key" },
    payload: {
      partId,
      memberNo: 7,
      direction: "company_to_member",
      quantity: 2,
      sourceStockEntityVersion: encodeEntityVersion(3),
    },
  });
  assert.equal(transferred.statusCode, 200, transferred.body);
  assert.equal(transferred.json().data.movement.sourceQuantity, 8);

  const picked = await app.inject({
    method: "POST",
    url: "/api/v1/companies/77/inventory/picks",
    headers: { "idempotency-key": "inventory-pick-key" },
    payload: {
      memberNo: 7,
      items: [{ partId, quantity: 2, stockEntityVersion: encodeEntityVersion(4) }],
    },
  });
  assert.equal(picked.statusCode, 200, picked.body);
  assert.equal(picked.json().data.movements.length, 1);
  assert.deepEqual(calls, {
    create: 1,
    update: 1,
    "adjust-company": 1,
    "adjust-member": 1,
    transfer: 1,
    pick: 1,
  });
  assert.equal(verifiedLookups, 7);
});

test("inventory mutations reject missing idempotency before auth and database work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInventoryMutationRoutes(app, {
    authenticator: { async authenticate() { throw new Error("auth must not run"); } },
    database: {
      maxConnections: 1,
      async checkReadiness() {},
      async close() {},
      async withTransaction() { throw new Error("database must not run"); },
    },
    supabaseUsers: { async getUser() { throw new Error("user lookup must not run"); } },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies/77/inventory/parts",
    payload: { name: "Relay" },
  });
  assert.equal(response.statusCode, 400, response.body);
});

test("inventory migration keeps runtime writes behind narrow atomic RPCs", () => {
  const migration = readFileSync(
    new URL("../../../packages/db/migrations/0000_baseline.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /inventory_parts_increment_entity_version/);
  assert.match(migration, /inventory_balances_increment_entity_version/);
  assert.match(migration, /membership\.role = 'manager'/);
  assert.match(migration, /ORDER BY balance\.location_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /ORDER BY balance\.part_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /private\.apply_inventory_pick_batch\(/);
  assert.match(migration, /INVENTORY_STOCK_VERSION_CONFLICT/);
  assert.match(migration, /private\.bump_company_sync_version\(p_company_id, 'company_inventory_version'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.pick_api_inventory_stock[\s\S]*TO smart_job_api/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.inventory_/i);
});
