import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
  createApiRequestAuthenticator,
  type SupabaseJwtVerifier,
  type SupabaseUserClient,
} from "../auth/index.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { registerViewerRoutes } from "../routes/viewer.js";

const userId = "d866fcba-cc44-4d4d-9712-edbc1221ccea";
const webSessionToken = "W".repeat(43);

test("viewer route combines verified Auth state with SQL-owned membership data", async (context) => {
  let databaseClosed = false;
  const verifier: SupabaseJwtVerifier = {
    issuer: "https://project.supabase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      throw new Error("not used");
    },
    async verifyAccessToken(token) {
      assert.equal(token, "header.payload.signature");
      return { userId, expiresAt: 4_102_444_800 };
    },
  };
  const supabaseUsers: SupabaseUserClient = {
    async getUser(token) {
      assert.equal(token, "header.payload.signature");
      return {
        userId,
        email: "viewer@example.test",
        emailVerified: true,
      };
    },
  };
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      assert.deepEqual(values, [userId]);
      const rows = text.includes("app_user.display_name")
        ? [{ display_name: "Verified Viewer" }]
        : [];
      return { rowCount: rows.length, rows: rows as unknown as Row[] };
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {
      databaseClosed = true;
    },
    async withTransaction(contextValue, work) {
      assert.equal(contextValue.userId, userId);
      return work(transaction);
    },
  };

  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerViewerRoutes(app, {
    database,
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier,
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
    supabaseUsers,
    webSessions: {
      async currentSession(token) {
        assert.equal(token, webSessionToken);
        return {
          absoluteExpiresAt: "2026-07-14T00:00:00.000Z",
          viewer: {
            uid: userId,
            email: "opaque@example.test",
            displayName: "Opaque Viewer",
            emailVerified: true,
            workspaces: [],
          },
        };
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    data: {
      uid: userId,
      email: "viewer@example.test",
      displayName: "Verified Viewer",
      emailVerified: true,
      workspaces: [],
    },
    meta: { requestId: response.headers["x-request-id"] },
  });
  assert.equal(databaseClosed, false);

  const opaqueResponse = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(opaqueResponse.statusCode, 200, opaqueResponse.body);
  assert.deepEqual(opaqueResponse.json().data, {
    uid: userId,
    email: "opaque@example.test",
    displayName: "Opaque Viewer",
    emailVerified: true,
    workspaces: [],
  });
});
