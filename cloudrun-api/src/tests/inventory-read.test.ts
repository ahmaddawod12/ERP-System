import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import {
  READ_COMPANY_INVENTORY_PAGE_SQL,
  READ_INVENTORY_ACCESS_SQL,
  READ_MEMBER_INVENTORY_PAGE_SQL,
  decodeInventoryListCursor,
  encodeInventoryListCursor,
  readCompanyInventoryPage,
} from "../inventory/read-repository.js";
import { registerInventoryReadRoutes } from "../routes/inventory-read.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "6f49e23a-73ca-43d8-9fab-df82e25ad8df";
const membershipId = "ba88d133-b4fb-4cb7-bdbb-4b906fb8c28e";
const internalCompanyId = "13f75f93-f96a-4873-b889-a7aeab06c333";
const firstPartId = "a4178724-4774-41b2-ac17-433ca2a819a3";
const secondPartId = "04a5348f-f405-4da6-9494-7cc5c21b38ae";
const thirdPartId = "4a7d2cff-522f-4fa3-854b-8ac2f87f958d";

function verifier(): SupabaseJwtVerifier {
  return {
    issuer: "https://project.supabase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      throw new Error("not used");
    },
    async verifyAccessToken() {
      return { userId, expiresAt: 4_102_444_800 };
    },
  };
}

function inventoryRow(
  partId: string,
  partNo: number,
  createdAt: string,
  status: "active" | "inactive" | "archived" = "active",
): Record<string, unknown> {
  return {
    part_id: partId,
    part_no: partNo,
    status,
    name: `Compressor relay ${partNo}`,
    active: status === "active",
    quantity_on_hand: "12.500",
    low_threshold: "3.000",
    unit: "piece",
    entity_version: "1",
    stock_entity_version: "2",
    created_at: new Date(createdAt),
    cursor_created_at: createdAt,
    updated_at: new Date(createdAt),
    archived_at: status === "archived" ? new Date(createdAt) : null,
  };
}

function database(options: {
  role: "manager" | "worker" | "user" | "basic" | "dev";
  pageSql?: string;
  rows?: Record<string, unknown>[];
  expectedPageValues?: readonly unknown[];
  inventoryEnabled?: boolean;
}): ApiDatabaseRuntime {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, RESOLVE_TENANT_SQL);
        assert.deepEqual(values, [userId, 42]);
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: internalCompanyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: options.role,
            member_no: 2,
            tier: "Team",
            enabled_modules: { inventory: options.inventoryEnabled ?? true },
          }] as unknown as Row[],
        };
      }
      if (queryIndex === 2) {
        assert.equal(text, READ_INVENTORY_ACCESS_SQL);
        assert.deepEqual(values, [internalCompanyId]);
        return {
          rowCount: 1,
          rows: [{
            role: options.role,
            membership_id: membershipId,
            is_dev: options.role === "dev",
            inventory_enabled: options.inventoryEnabled ?? true,
          }] as unknown as Row[],
        };
      }

      assert.equal(text, options.pageSql);
      assert.deepEqual(values, options.expectedPageValues);
      return {
        rowCount: options.rows?.length ?? 0,
        rows: (options.rows ?? []) as unknown as Row[],
      };
    },
  };

  return {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, userId);
      return work(transaction);
    },
  };
}

async function createRouteApp(databaseRuntime: ApiDatabaseRuntime) {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  registerInventoryReadRoutes(app, {
    database: databaseRuntime,
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier(),
      webSessions: {
        async authenticateSession() {
          throw new Error("not used");
        },
      },
    }),
  });
  return app;
}

test("company inventory route applies SQL filters and returns canonical cursor DTOs", async (context) => {
  const app = await createRouteApp(database({
    role: "manager",
    pageSql: READ_COMPANY_INVENTORY_PAGE_SQL,
    rows: [
      inventoryRow(firstPartId, 3, "2026-07-13T12:00:00.000Z"),
      inventoryRow(secondPartId, 2, "2026-07-13T11:00:00.123456Z", "inactive"),
      inventoryRow(thirdPartId, 1, "2026-07-13T10:00:00.000Z"),
    ],
    expectedPageValues: [
      internalCompanyId,
      "relay%",
      "relay\\%",
      ["active", "inactive"],
      null,
      null,
      3,
    ],
  }));
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/companies/42/inventory?search=relay%25&pageSize=2&status=active&status=inactive",
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[1].createdAt, "2026-07-13T11:00:00.123Z");
  assert.deepEqual(body.data.items[0], {
    partId: firstPartId,
    partNo: 3,
    status: "active",
    name: "Compressor relay 3",
    active: true,
    quantity: 12.5,
    lowThreshold: 3,
    unit: "piece",
    entityVersion: "ev1.MQ",
    stockEntityVersion: "ev1.Mg",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    archivedAt: null,
  });
  assert.equal(body.data.items[1].status, "inactive");
  assert.equal(typeof body.data.nextCursor, "string");
  assert.equal(body.meta.nextCursor, body.data.nextCursor);
  assert.deepEqual(decodeInventoryListCursor(body.data.nextCursor), {
    createdAt: "2026-07-13T11:00:00.123456Z",
    id: secondPartId,
  });
  assert.doesNotMatch(body.data.nextCursor, /\|/);
});

test("worker inventory is restricted to the authenticated member route", async (context) => {
  const deniedApp = await createRouteApp(database({ role: "worker" }));
  const memberApp = await createRouteApp(database({
    role: "worker",
    pageSql: READ_MEMBER_INVENTORY_PAGE_SQL,
    rows: [inventoryRow(firstPartId, 3, "2026-07-13T12:00:00.000Z")],
    expectedPageValues: [internalCompanyId, null, null, null, null, null, 51],
  }));
  context.after(async () => {
    await deniedApp.close();
    await memberApp.close();
  });

  const companyResponse = await deniedApp.inject({
    method: "GET",
    url: "/api/v1/companies/42/inventory",
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(companyResponse.statusCode, 403, companyResponse.body);
  assert.equal(companyResponse.json().error.code, "COMPANY_INVENTORY_FORBIDDEN");

  const memberResponse = await memberApp.inject({
    method: "GET",
    url: "/api/v1/companies/42/inventory/me",
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(memberResponse.statusCode, 200, memberResponse.body);
  assert.equal(memberResponse.json().data.items.length, 1);
});

test("basic users and disabled subscriptions fail before inventory row queries", async (context) => {
  const basicApp = await createRouteApp(database({ role: "basic" }));
  const disabledApp = await createRouteApp(database({
    role: "manager",
    inventoryEnabled: false,
  }));
  context.after(async () => {
    await basicApp.close();
    await disabledApp.close();
  });

  const basicResponse = await basicApp.inject({
    method: "GET",
    url: "/api/v1/companies/42/inventory/me",
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(basicResponse.statusCode, 403, basicResponse.body);
  assert.equal(basicResponse.json().error.code, "MEMBER_INVENTORY_FORBIDDEN");

  const disabledResponse = await disabledApp.inject({
    method: "GET",
    url: "/api/v1/companies/42/inventory",
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(disabledResponse.statusCode, 403, disabledResponse.body);
  assert.equal(disabledResponse.json().error.code, "INVENTORY_MODULE_DISABLED");
});

test("inventory cursors are canonical and malformed cursors fail closed", () => {
  const cursor = encodeInventoryListCursor("2026-07-13T12:00:00.123456Z", firstPartId);
  assert.deepEqual(decodeInventoryListCursor(cursor), {
    createdAt: "2026-07-13T12:00:00.123456Z",
    id: firstPartId,
  });
  assert.throws(
    () => decodeInventoryListCursor("not-a-canonical-cursor"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR"
    ),
  );
});

test("inventory reads default to 50 rows and fetch only one lookahead row", async () => {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, READ_INVENTORY_ACCESS_SQL);
        return {
          rowCount: 1,
          rows: [{
            role: "manager",
            membership_id: membershipId,
            is_dev: false,
            inventory_enabled: true,
          }] as unknown as Row[],
        };
      }
      assert.equal(text, READ_COMPANY_INVENTORY_PAGE_SQL);
      assert.deepEqual(values, [internalCompanyId, null, null, null, null, null, 51]);
      return { rowCount: 0, rows: [] };
    },
  };

  assert.deepEqual(await readCompanyInventoryPage(transaction, internalCompanyId, {}), {
    items: [],
    nextCursor: null,
  });
});

test("inventory SQL enforces entitlement, role, tenant, location, filters, and keyset bounds", () => {
  assert.match(READ_INVENTORY_ACCESS_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_INVENTORY_ACCESS_SQL, /membership\.user_id = private\.app_auth_uid\(\)/);

  assert.match(READ_COMPANY_INVENTORY_PAGE_SQL, /part\.company_id = \$1::uuid/);
  assert.match(READ_COMPANY_INVENTORY_PAGE_SQL, /requester\.role IN \('manager', 'user', 'dev'\)/);
  assert.doesNotMatch(READ_COMPANY_INVENTORY_PAGE_SQL, /requester\.role IN \([^)]*'worker'/);
  assert.match(READ_COMPANY_INVENTORY_PAGE_SQL, /location\.location_type = 'company'/);
  assert.match(READ_COMPANY_INVENTORY_PAGE_SQL, /location\.membership_id IS NULL/);

  assert.match(READ_MEMBER_INVENTORY_PAGE_SQL, /location\.membership_id = requester\.membership_id/);
  assert.match(READ_MEMBER_INVENTORY_PAGE_SQL, /requester\.role IN \('manager', 'worker', 'user', 'dev'\)/);
  assert.doesNotMatch(READ_MEMBER_INVENTORY_PAGE_SQL, /targetUid|target_uid|p_target_uid/i);

  for (const sql of [READ_COMPANY_INVENTORY_PAGE_SQL, READ_MEMBER_INVENTORY_PAGE_SQL]) {
    assert.match(sql, /entitlement\.inventory_enabled/);
    assert.match(sql, /pg_catalog\.strpos\(pg_catalog\.lower\(part\.name\)/);
    assert.match(sql, /part\.part_no::text LIKE/);
    assert.match(sql, /'archived' = ANY\(\$4::text\[\]\)/);
    assert.match(sql, /\(part\.created_at, part\.id\) < \(\$5::timestamptz, \$6::uuid\)/);
    assert.match(sql, /to_char\([\s\S]*part\.created_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_created_at/);
    assert.match(sql, /ORDER BY part\.created_at DESC, part\.id DESC/);
    assert.match(sql, /LIMIT \$7::integer/);
    assert.doesNotMatch(sql, /\bOFFSET\b|SELECT \*/i);
  }
});

test("existing database foundation supplies inventory SELECT grants and RLS", () => {
  const foundation = readFileSync(
    new URL("../../../packages/db/migrations/0006_api_security_foundation.sql", import.meta.url),
    "utf8",
  );
  const baseline = readFileSync(
    new URL("../../../packages/db/migrations/0000_optimized_baseline.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    foundation,
    /GRANT SELECT ON[\s\S]*public\.inventory_locations,[\s\S]*public\.inventory_parts,[\s\S]*public\.inventory_balances,[\s\S]*TO smart_job_api/,
  );
  assert.match(baseline, /CREATE POLICY inventory_locations_company_read_policy[\s\S]*app_has_company_access\(company_id\)/);
  assert.match(baseline, /CREATE POLICY inventory_parts_company_read_policy[\s\S]*app_has_company_access\(company_id\)/);
  assert.match(baseline, /CREATE POLICY inventory_balances_company_read_policy[\s\S]*app_has_company_access\(loc\.company_id\)/);
});
