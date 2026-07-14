import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { buildApp } from "../app.js";
import { READ_BOOTSTRAP_SQL } from "../bootstrap/repository.js";
import { loadConfig } from "../config.js";
import { registerBootstrapRoutes } from "../routes/bootstrap.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "5f5bd2f8-a62f-43de-8f4d-27c814607dac";
const internalCompanyId = "b879bd41-3211-4511-b5e9-323b0ff11ee7";
const webSessionToken = "B".repeat(43);

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

function database(): ApiDatabaseRuntime {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex % 2 === 1) {
        assert.equal(text, RESOLVE_TENANT_SQL);
        assert.deepEqual(values, [userId, 42]);
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: internalCompanyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: "worker",
            member_no: 7,
            tier: "Team",
            enabled_modules: { documents: false },
          }] as unknown as Row[],
        };
      }

      assert.equal(text, READ_BOOTSTRAP_SQL);
      assert.deepEqual(values, [internalCompanyId, "worker"]);
      return {
        rowCount: 1,
        rows: [{
          jobs_version: 3,
          documents_version: 4,
          clients_version: 5,
          workers_version: 6,
          company_inventory_version: 7,
          sync_updated_at: new Date("2026-07-13T12:00:00.000Z"),
          jobs_count: 2,
          clients_count: 8,
          inventory_parts_count: 9,
          documents_count: 0,
          pending_document_tasks_count: 0,
        }] as unknown as Row[],
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

test("bootstrap normalizes public tenant id before scoped count queries", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerBootstrapRoutes(app, {
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

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/companies/42/bootstrap",
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    data: {
      workspace: {
        companyId: 42,
        name: "Field Services",
        accountType: "business",
        role: "worker",
        memberNo: 7,
        enabledModules: ["clients", "companyinventory", "inventory", "solojob", "team", "teaminventory"],
      },
      syncState: {
        jobsVersion: 3,
        documentsVersion: 4,
        clientsVersion: 5,
        workersVersion: 6,
        companyInventoryVersion: 7,
        updatedAt: "2026-07-13T12:00:00.000Z",
      },
      counts: {
        jobs: 2,
        clients: 8,
        inventoryParts: 9,
        documents: 0,
        pendingDocumentTasks: 0,
      },
    },
    meta: { requestId: response.headers["x-request-id"] },
  });

  const webResponse = await app.inject({
    method: "GET",
    url: "/api/v1/companies/42/bootstrap",
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(webResponse.statusCode, 200, webResponse.body);
  assert.deepEqual(webResponse.json().data, response.json().data);
});

test("bootstrap SQL keeps entitlement-aware counts in Postgres", () => {
  assert.match(READ_BOOTSTRAP_SQL, /count\(\*\)::integer/);
  assert.match(READ_BOOTSTRAP_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_BOOTSTRAP_SQL, /entitlements\.jobs_enabled/);
  assert.match(
    READ_BOOTSTRAP_SQL,
    /\$2::text = 'worker' OR NOT entitlements\.documents_enabled/,
  );
  assert.doesNotMatch(READ_BOOTSTRAP_SQL, /SELECT \*/);
});
