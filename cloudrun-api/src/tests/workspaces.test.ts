import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { registerWorkspaceRoutes } from "../routes/workspaces.js";
import { LIST_WORKSPACES_SQL } from "../workspaces/repository.js";

const viewerId = "8b6867e1-1010-4fc6-8501-b1746b27fd30";
const webSessionToken = "S".repeat(43);

function fakeVerifier(): SupabaseJwtVerifier {
  return {
    issuer: "https://project.supabase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAccessToken() {
      return { userId: viewerId, expiresAt: 4_102_444_800 };
    },
    async verifyAuthorizationHeader(header) {
      assert.equal(header, "Bearer header.payload.signature");
      return { userId: viewerId, expiresAt: 4_102_444_800 };
    },
  };
}

function fakeDatabase(): ApiDatabaseRuntime {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      assert.match(text, /LIMIT 200/);
      assert.deepEqual(values, [viewerId]);
      const rows = [
        {
          public_company_id: "101",
          name: "Alpha Services",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { clients: true, documents: false, inventory: true },
        },
        {
          public_company_id: "102",
          name: "Beta Services",
          account_type: "solo",
          role: "user",
          member_no: 2,
          tier: "Solo",
          enabled_modules: { clients: true },
        },
      ];
      return {
        rowCount: 2,
        rows: rows as unknown as Row[],
      };
    },
  };

  return {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, viewerId);
      return work(transaction);
    },
  };
}

test("workspace route authenticates, scopes SQL, and maps safe DTOs", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerWorkspaceRoutes(app, {
    database: fakeDatabase(),
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: fakeVerifier(),
      webSessions: {
        async authenticateSession(token) {
          assert.equal(token, webSessionToken);
          return {
            userId: viewerId,
            absoluteExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
          };
        },
      },
    }),
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/workspaces",
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.json(), {
    ok: true,
    data: [
      {
        companyId: 101,
        name: "Alpha Services",
        accountType: "business",
        role: "manager",
        memberNo: 1,
        enabledModules: ["clients", "companyinventory", "inventory", "solojob", "team", "teaminventory"],
      },
      {
        companyId: 102,
        name: "Beta Services",
        accountType: "solo",
        role: "user",
        memberNo: 2,
        enabledModules: ["clients", "documents", "inventory", "solojob"],
      },
    ],
    meta: { requestId: response.headers["x-request-id"] },
  });

  const webResponse = await app.inject({
    method: "GET",
    url: "/api/v1/workspaces",
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(webResponse.statusCode, 200, webResponse.body);
  assert.deepEqual(webResponse.json().data, response.json().data);

  const duplicateAuthorization = await app.inject({
    method: "GET",
    url: "/api/v1/workspaces",
    headers: {
      authorization: [
        "Bearer header.payload.signature",
        `SmartJobSession ${webSessionToken}`,
      ] as unknown as string,
    },
  });
  assert.equal(duplicateAuthorization.statusCode, 401, duplicateAuthorization.body);
  assert.equal(duplicateAuthorization.json().error.code, "AUTHORIZATION_INVALID");
});

test("workspace SQL handles dev visibility without trusting JWT metadata", () => {
  assert.match(LIST_WORKSPACES_SQL, /app_user\.system_role/);
  assert.match(LIST_WORKSPACES_SQL, /membership\.user_id = \$1/);
  assert.match(LIST_WORKSPACES_SQL, /private\.get_company_module_entitlements/);
  assert.doesNotMatch(LIST_WORKSPACES_SQL, /jwt|metadata/i);
});
