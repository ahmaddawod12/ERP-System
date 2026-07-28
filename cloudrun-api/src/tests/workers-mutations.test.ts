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
import { registerWorkerMutationRoutes } from "../routes/workers-mutations.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";
import {
  DISABLE_WORKER_MEMBERSHIP_SQL,
  UPDATE_WORKER_MEMBERSHIP_SQL,
} from "../workers/mutation-repository.js";

const userId = "f713c93b-a13f-481f-9c1e-8b5724a6b93f";
const internalCompanyId = "5e746cb5-b9ff-40e6-8c1d-1d41bb27ea90";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function workerRow(entityVersion: string, overrides: Record<string, unknown> = {}) {
  return {
    member_no: 17,
    role: "worker",
    status: "active",
    display_name: "Field Technician",
    email: "technician@example.test",
    phone_number: "+972500000000",
    entity_version: entityVersion,
    joined_at: new Date("2026-07-13T12:00:00.000Z"),
    created_at: new Date("2026-07-13T12:00:00.000Z"),
    updated_at: new Date("2026-07-13T12:00:00.000Z"),
    ...overrides,
  };
}

test("worker mutations are verified, idempotent, versioned, and membership scoped", async (context) => {
  const claims = new Map<string, {
    requestHash: Buffer;
    responseStatus: number | null;
    responseBody: unknown;
    completedAt: Date | null;
  }>();
  const rpcCalls = { update: 0, disable: 0 };
  let verifiedLookups = 0;

  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        assert.deepEqual(values, [userId, 77]);
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Team Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { team: true },
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
      if (text === UPDATE_WORKER_MEMBERSHIP_SQL) {
        rpcCalls.update += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], 17);
        assert.equal(values?.[2], "1");
        assert.deepEqual(JSON.parse(String(values?.[3])), {
          displayName: "Lead Technician",
          phoneNumber: null,
          role: "user",
        });
        return result<Row>([workerRow("2", {
          role: "user",
          display_name: "Lead Technician",
          phone_number: null,
          updated_at: new Date("2026-07-13T12:05:00.000Z"),
        })]);
      }
      if (text === DISABLE_WORKER_MEMBERSHIP_SQL) {
        rpcCalls.disable += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], 17);
        assert.equal(values?.[2], "2");
        return result<Row>([workerRow("3", {
          role: "user",
          status: "disabled",
          display_name: "Lead Technician",
          phone_number: null,
          updated_at: new Date("2026-07-13T12:10:00.000Z"),
        })]);
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
      throw new Error(`Unexpected SQL in test: ${text.slice(0, 100)}`);
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
        accessToken: "worker.payload.signature",
      };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerWorkerMutationRoutes(app, {
    authenticator,
    database,
    firebaseUsers: {
      async getUser(accessToken) {
        verifiedLookups += 1;
        assert.equal(accessToken, "worker.payload.signature");
        return { userId, email: "manager@example.test", emailVerified: true };
      },
    },
  });

  const updateRequest = {
    method: "PATCH" as const,
    url: "/api/v1/companies/77/workers/17",
    headers: { "idempotency-key": "worker-update-key-1234" },
    payload: {
      entityVersion: encodeEntityVersion(1),
      displayName: " Lead Technician ",
      phoneNumber: null,
      role: "user",
    },
  };
  const updated = await app.inject(updateRequest);
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.displayName, "Lead Technician");
  assert.equal(updated.json().data.entityVersion, encodeEntityVersion(2));
  const updateReplay = await app.inject(updateRequest);
  assert.equal(updateReplay.statusCode, 200, updateReplay.body);
  assert.deepEqual(updateReplay.json().data, updated.json().data);

  const disableRequest = {
    method: "DELETE" as const,
    url: "/api/v1/companies/77/workers/17",
    headers: { "idempotency-key": "worker-disable-key-1234" },
    payload: { entityVersion: encodeEntityVersion(2) },
  };
  const disabled = await app.inject(disableRequest);
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().data.status, "disabled");
  assert.equal(disabled.json().data.entityVersion, encodeEntityVersion(3));
  const disableReplay = await app.inject(disableRequest);
  assert.equal(disableReplay.statusCode, 200, disableReplay.body);
  assert.deepEqual(disableReplay.json().data, disabled.json().data);

  assert.deepEqual(rpcCalls, { update: 1, disable: 1 });
  assert.equal(verifiedLookups, 4);
});

test("worker mutation routes reject missing idempotency before handler work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerWorkerMutationRoutes(app, {
    authenticator: {
      async authenticate() {
        throw new Error("handler must not run");
      },
    },
    database: {
      maxConnections: 1,
      async checkReadiness() {},
      async close() {},
      async withTransaction() {
        throw new Error("database must not run");
      },
    },
    firebaseUsers: {
      async getUser() {
        throw new Error("Auth lookup must not run");
      },
    },
  });

  const response = await app.inject({
    method: "PATCH",
    url: "/api/v1/companies/77/workers/17",
    payload: { entityVersion: encodeEntityVersion(1), displayName: "Updated" },
  });
  assert.equal(response.statusCode, 400, response.body);
});

test("worker mutation migration keeps authority and lifecycle guards in SQL", () => {
  const migration = readFileSync(
    new URL("../../../packages/db/migrations/0000_baseline.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /requester\.role = 'manager'/);
  assert.match(migration, /enabled_modules -> 'team'/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /WORKER_ENTITY_VERSION_CONFLICT/);
  assert.match(migration, /job\.status IN \('pending', 'waiting'\)/);
  assert.match(migration, /balance\.quantity_on_hand > 0/);
  assert.match(migration, /status.*'disabled'/s);
  assert.match(migration, /bump_company_sync_version\(p_company_id, 'workers_version'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.update_api_worker_membership[\s\S]*TO smart_job_api/);
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE|DELETE) ON public\.company_memberships TO smart_job_api/i,
  );
});
