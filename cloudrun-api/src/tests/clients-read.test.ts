import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import {
  READ_CLIENTS_ENTITLEMENT_SQL,
  READ_CLIENTS_PAGE_SQL,
  decodeClientListCursor,
  encodeClientListCursor,
  readClientsPage,
} from "../clients/read-repository.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerClientsReadRoutes } from "../routes/clients-read.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "3ff2c74a-b0bf-4c46-b759-dbdf23d93ab1";
const internalCompanyId = "b879bd41-3211-4511-b5e9-323b0ff11ee7";
const webSessionToken = "C".repeat(43);
const firstClientId = "ffe77602-d9b1-4a53-97e1-52df99f97224";
const secondClientId = "4877089d-60c8-44f6-be79-116e6f3b34cc";
const thirdClientId = "126bf50f-51de-4cf7-a2a1-90fb615e12b5";

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

function clientRow(
  clientId: string,
  clientNo: number,
  createdAt: string,
): Record<string, unknown> {
  return {
    client_id: clientId,
    client_no: clientNo,
    status: clientNo === 1 ? "archived" : "active",
    name: `Northwind ${clientNo}`,
    phone: "+97235550101",
    email: `dispatch${clientNo}@northwind.example`,
    address: "10 Service Road",
    city: "Haifa",
    vat_number: "515987654",
    notes: null,
    entity_version: "1",
    created_at: new Date(createdAt),
    cursor_created_at: createdAt,
    updated_at: new Date(createdAt),
    archived_at: clientNo === 1 ? new Date(createdAt) : null,
  };
}

function database(): ApiDatabaseRuntime {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      const phase = queryIndex % 3;
      queryIndex += 1;
      if (phase === 0) {
        assert.equal(text, RESOLVE_TENANT_SQL);
        assert.deepEqual(values, [userId, 42]);
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: internalCompanyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: "manager",
            member_no: 1,
            tier: "Team",
            enabled_modules: { clients: true },
          }] as unknown as Row[],
        };
      }
      if (phase === 1) {
        assert.equal(text, READ_CLIENTS_ENTITLEMENT_SQL);
        assert.deepEqual(values, [internalCompanyId]);
        return {
          rowCount: 1,
          rows: [{ clients_enabled: true }] as unknown as Row[],
        };
      }

      assert.equal(text, READ_CLIENTS_PAGE_SQL);
      assert.deepEqual(values, [internalCompanyId, "Northwind", "active", null, null, 3]);
      return {
        rowCount: 3,
        rows: [
          clientRow(firstClientId, 3, "2026-07-13T12:00:00.000Z"),
          clientRow(secondClientId, 2, "2026-07-13T11:00:00.123456Z"),
          clientRow(thirdClientId, 1, "2026-07-13T10:00:00.000Z"),
        ] as unknown as Row[],
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

test("clients route applies bounded SQL search and returns canonical cursor DTOs", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerClientsReadRoutes(app, {
    database: database(),
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier(),
      webSessions: {
        async authenticateSession(token) {
          assert.equal(token, webSessionToken);
          return {
            userId,
            absoluteExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
          };
        },
      },
    }),
  });

  const url = "/api/v1/companies/42/clients?search=North%25wind&pageSize=2";
  const response = await app.inject({
    method: "GET",
    url,
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[1].createdAt, "2026-07-13T11:00:00.123Z");
  assert.deepEqual(body.data.items[0], {
    clientId: firstClientId,
    clientNo: 3,
    status: "active",
    name: "Northwind 3",
    phone: "+97235550101",
    email: "dispatch3@northwind.example",
    address: "10 Service Road",
    city: "Haifa",
    vatNumber: "515987654",
    notes: null,
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    archivedAt: null,
  });
  assert.equal(typeof body.data.nextCursor, "string");
  assert.equal(body.meta.nextCursor, body.data.nextCursor);
  assert.deepEqual(decodeClientListCursor(body.data.nextCursor), {
    createdAt: "2026-07-13T11:00:00.123456Z",
    id: secondClientId,
  });
  assert.doesNotMatch(body.data.nextCursor, /\|/);

  const webResponse = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(webResponse.statusCode, 200, webResponse.body);
  assert.deepEqual(webResponse.json().data, body.data);
});

test("client cursors are canonical and malformed cursors fail closed", () => {
  const cursor = encodeClientListCursor("2026-07-13T12:00:00.123456Z", firstClientId);
  assert.deepEqual(decodeClientListCursor(cursor), {
    createdAt: "2026-07-13T12:00:00.123456Z",
    id: firstClientId,
  });
  assert.throws(
    () => decodeClientListCursor("not-a-canonical-cursor"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR"
    ),
  );
});

test("client reads default to 50 rows and fetch only one lookahead row", async () => {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, READ_CLIENTS_ENTITLEMENT_SQL);
        return {
          rowCount: 1,
          rows: [{ clients_enabled: true }] as unknown as Row[],
        };
      }
      assert.equal(text, READ_CLIENTS_PAGE_SQL);
      assert.deepEqual(values, [internalCompanyId, null, "active", null, null, 51]);
      return { rowCount: 0, rows: [] };
    },
  };

  assert.deepEqual(await readClientsPage(transaction, internalCompanyId, {}), {
    items: [],
    nextCursor: null,
  });
});

test("client read SQL keeps entitlement, role, tenant, search, and keyset checks in Postgres", () => {
  assert.match(READ_CLIENTS_ENTITLEMENT_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_CLIENTS_PAGE_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_CLIENTS_PAGE_SQL, /entitlement\.clients_enabled/);
  assert.match(READ_CLIENTS_PAGE_SQL, /membership\.user_id = private\.app_auth_uid\(\)/);
  assert.match(READ_CLIENTS_PAGE_SQL, /requester\.role IN \('manager', 'worker', 'user', 'basic', 'dev'\)/);
  assert.match(READ_CLIENTS_PAGE_SQL, /client\.company_id = \$1::uuid/);
  assert.match(READ_CLIENTS_PAGE_SQL, /pg_catalog\.lower\(client\.name\) LIKE/);
  assert.match(READ_CLIENTS_PAGE_SQL, /client\.status::text = \$3::text/);
  assert.match(READ_CLIENTS_PAGE_SQL, /pg_catalog\.lower\(COALESCE\(client\.city/);
  assert.match(READ_CLIENTS_PAGE_SQL, /COALESCE\(client\.vat_number/);
  assert.match(READ_CLIENTS_PAGE_SQL, /ESCAPE '\\'/);
  assert.match(READ_CLIENTS_PAGE_SQL, /\(client\.created_at, client\.id\) < \(\$4::timestamptz, \$5::uuid\)/);
  assert.match(READ_CLIENTS_PAGE_SQL, /to_char\([\s\S]*client\.created_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_created_at/);
  assert.match(READ_CLIENTS_PAGE_SQL, /ORDER BY client\.created_at DESC, client\.id DESC/);
  assert.match(READ_CLIENTS_PAGE_SQL, /LIMIT \$6::integer/);
  assert.doesNotMatch(READ_CLIENTS_PAGE_SQL, /\bOFFSET\b|SELECT \*/i);
});

test("existing database foundation supplies request context, RLS, and least-privileged client SELECT", () => {
  const foundation = readFileSync(
    new URL("../../../packages/db/migrations/0006_api_security_foundation.sql", import.meta.url),
    "utf8",
  );
  const baseline = readFileSync(
    new URL("../../../packages/db/migrations/0000_optimized_baseline.sql", import.meta.url),
    "utf8",
  );
  const runtime = readFileSync(new URL("../database/runtime.js", import.meta.url), "utf8");

  assert.match(foundation, /GRANT SELECT ON[\s\S]*public\.clients[\s\S]*TO smart_job_api/);
  assert.match(baseline, /CREATE POLICY clients_company_read_policy[\s\S]*app_has_company_access\(company_id\)/);
  assert.match(runtime, /API_DATABASE_ROLE = "smart_job_api"/);
  assert.match(runtime, /DATABASE_URL must authenticate with/);
  assert.match(runtime, /private\.set_api_request_context/);
});
