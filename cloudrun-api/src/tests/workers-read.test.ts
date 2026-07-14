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
import { registerWorkersReadRoutes } from "../routes/workers-read.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";
import {
  READ_WORKERS_ACCESS_SQL,
  READ_WORKERS_PAGE_SQL,
  decodeWorkerListCursor,
  encodeWorkerListCursor,
  readWorkersPage,
} from "../workers/read-repository.js";

const userId = "3ff2c74a-b0bf-4c46-b759-dbdf23d93ab1";
const internalCompanyId = "b879bd41-3211-4511-b5e9-323b0ff11ee7";
const webSessionToken = "W".repeat(43);
const firstMembershipId = "ffe77602-d9b1-4a53-97e1-52df99f97224";
const secondMembershipId = "4877089d-60c8-44f6-be79-116e6f3b34cc";
const thirdMembershipId = "126bf50f-51de-4cf7-a2a1-90fb615e12b5";

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

function workerRow(
  membershipId: string,
  memberNo: number,
  createdAt: string,
): Record<string, unknown> {
  return {
    membership_id: membershipId,
    member_no: memberNo,
    role: memberNo === 3 ? "user" : "worker",
    status: memberNo === 1 ? "disabled" : "active",
    display_name: `Technician ${memberNo}`,
    email: `technician${memberNo}@example.test`,
    phone_number: "+972500000000",
    entity_version: 1,
    joined_at: new Date(createdAt),
    created_at: new Date(createdAt),
    cursor_created_at: createdAt,
    updated_at: new Date(createdAt),
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
            enabled_modules: { team: true },
          }] as unknown as Row[],
        };
      }
      if (phase === 1) {
        assert.equal(text, READ_WORKERS_ACCESS_SQL);
        assert.deepEqual(values, [internalCompanyId]);
        return {
          rowCount: 1,
          rows: [{
            role: "manager",
            is_dev: false,
            subscription_active: true,
            team_enabled: true,
          }] as unknown as Row[],
        };
      }

      assert.equal(text, READ_WORKERS_PAGE_SQL);
      assert.deepEqual(values, [
        internalCompanyId,
        ["worker", "user"],
        ["active"],
        "Tech",
        null,
        null,
        3,
      ]);
      return {
        rowCount: 3,
        rows: [
          workerRow(firstMembershipId, 3, "2026-07-13T12:00:00.000Z"),
          workerRow(secondMembershipId, 2, "2026-07-13T11:00:00.123456Z"),
          workerRow(thirdMembershipId, 1, "2026-07-13T10:00:00.000Z"),
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

test("workers route applies SQL filters and returns canonical cursor DTOs", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerWorkersReadRoutes(app, {
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

  const url = "/api/v1/companies/42/workers?role=worker&role=user&status=active&search=Tech%25&pageSize=2";
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
    memberNo: 3,
    role: "user",
    status: "active",
    displayName: "Technician 3",
    email: "technician3@example.test",
    phoneNumber: "+972500000000",
    entityVersion: "ev1.MQ",
    joinedAt: "2026-07-13T12:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  });
  assert.equal("membershipId" in body.data.items[0], false);
  assert.equal(typeof body.data.nextCursor, "string");
  assert.equal(body.meta.nextCursor, body.data.nextCursor);
  assert.deepEqual(decodeWorkerListCursor(body.data.nextCursor), {
    createdAt: "2026-07-13T11:00:00.123456Z",
    id: secondMembershipId,
  });

  const webResponse = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(webResponse.statusCode, 200, webResponse.body);
  assert.deepEqual(webResponse.json().data, body.data);
});

test("worker cursors are canonical and malformed cursors fail closed", () => {
  const cursor = encodeWorkerListCursor("2026-07-13T12:00:00.123456Z", firstMembershipId);
  assert.deepEqual(decodeWorkerListCursor(cursor), {
    createdAt: "2026-07-13T12:00:00.123456Z",
    id: firstMembershipId,
  });
  assert.throws(
    () => decodeWorkerListCursor("not-a-canonical-cursor"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR"
    ),
  );
});

test("worker reads default to 50 rows and fetch only one lookahead row", async () => {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, READ_WORKERS_ACCESS_SQL);
        return {
          rowCount: 1,
          rows: [{
            role: "manager",
            is_dev: false,
            subscription_active: true,
            team_enabled: true,
          }] as unknown as Row[],
        };
      }
      assert.equal(text, READ_WORKERS_PAGE_SQL);
      assert.deepEqual(values, [internalCompanyId, null, null, null, null, null, 51]);
      return { rowCount: 0, rows: [] };
    },
  };

  assert.deepEqual(await readWorkersPage(transaction, internalCompanyId, {}), {
    items: [],
    nextCursor: null,
  });
});

test("worker reads reject non-manager memberships and inactive team entitlements", async () => {
  for (const access of [
    { role: "worker", is_dev: false, subscription_active: true, team_enabled: true },
    { role: "manager", is_dev: false, subscription_active: false, team_enabled: true },
    { role: "manager", is_dev: false, subscription_active: true, team_enabled: false },
  ]) {
    const transaction: DatabaseQueryable = {
      async query<Row extends QueryResultRow>(text: string) {
        assert.equal(text, READ_WORKERS_ACCESS_SQL);
        return { rowCount: 1, rows: [access] as unknown as Row[] };
      },
    };
    await assert.rejects(
      readWorkersPage(transaction, internalCompanyId, {}),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && ["WORKERS_ACCESS_FORBIDDEN", "WORKERS_MODULE_DISABLED"].includes(String(error.code))
      ),
    );
  }
});

test("worker read SQL keeps role, entitlement, tenant, filters, and keyset checks in Postgres", () => {
  assert.match(READ_WORKERS_ACCESS_SQL, /membership\.user_id = private\.app_auth_uid\(\)/);
  assert.match(READ_WORKERS_ACCESS_SQL, /subscription\.status IN \('active', 'trial'\)/);
  assert.match(READ_WORKERS_ACCESS_SQL, /enabled_modules -> 'team'/);
  assert.match(READ_WORKERS_PAGE_SQL, /access\.role = 'manager'/);
  assert.match(READ_WORKERS_PAGE_SQL, /access\.subscription_active/);
  assert.match(READ_WORKERS_PAGE_SQL, /access\.team_enabled/);
  assert.match(READ_WORKERS_PAGE_SQL, /membership\.company_id = \$1::uuid/);
  assert.match(READ_WORKERS_PAGE_SQL, /membership\.role IN \('worker', 'user', 'basic'\)/);
  assert.match(READ_WORKERS_PAGE_SQL, /membership\.role = ANY\(\$2::public\.membership_role\[\]\)/);
  assert.match(READ_WORKERS_PAGE_SQL, /membership\.status = ANY\(\$3::public\.membership_status\[\]\)/);
  assert.match(READ_WORKERS_PAGE_SQL, /pg_catalog\.lower\(COALESCE\(membership\.display_name/);
  assert.match(READ_WORKERS_PAGE_SQL, /\(membership\.created_at, membership\.id\) < \(\$5::timestamptz, \$6::uuid\)/);
  assert.match(READ_WORKERS_PAGE_SQL, /to_char\([\s\S]*membership\.created_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_created_at/);
  assert.match(READ_WORKERS_PAGE_SQL, /ORDER BY membership\.created_at DESC, membership\.id DESC/);
  assert.match(READ_WORKERS_PAGE_SQL, /LIMIT \$7::integer/);
  assert.doesNotMatch(READ_WORKERS_PAGE_SQL, /\bOFFSET\b|SELECT \*/i);
});

test("existing database foundation supplies RLS and least-privileged team SELECT", () => {
  const foundation = readFileSync(
    new URL("../../../packages/db/migrations/0006_api_security_foundation.sql", import.meta.url),
    "utf8",
  );
  const baseline = readFileSync(
    new URL("../../../packages/db/migrations/0000_optimized_baseline.sql", import.meta.url),
    "utf8",
  );

  assert.match(foundation, /GRANT SELECT ON[\s\S]*public\.company_subscriptions,[\s\S]*public\.company_memberships/);
  assert.match(baseline, /CREATE POLICY company_memberships_company_read_policy[\s\S]*requester\.role = 'manager'/);
  assert.match(foundation, /CREATE POLICY app_users_api_self_read[\s\S]*id = private\.app_auth_uid\(\) OR private\.app_is_dev\(\)/);
});
