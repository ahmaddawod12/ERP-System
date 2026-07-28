import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import {
  CREATE_CLIENT_SQL,
  DELETE_OR_ARCHIVE_CLIENT_SQL,
  UPDATE_CLIENT_SQL,
} from "../clients/mutation-repository.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { registerClientMutationRoutes } from "../routes/clients-mutations.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const internalCompanyId = "26963503-982a-4552-97d0-45b5fdbfbda9";
const clientId = "9b4f0638-e356-4f78-8981-e94a5c9a484c";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function clientRow(entityVersion: string, overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    client_no: 12,
    status: "active",
    name: "Northwind Cooling",
    phone: "+97235550101",
    email: "dispatch@northwind.example",
    address: null,
    city: "Haifa",
    vat_number: "515987654",
    notes: null,
    entity_version: entityVersion,
    created_at: new Date("2026-07-13T12:00:00.000Z"),
    updated_at: new Date("2026-07-13T12:00:00.000Z"),
    archived_at: null,
    ...overrides,
  };
}

test("client mutations require verified identity, idempotency, and one secure SQL entrypoint", async (context) => {
  const claims = new Map<string, {
    requestHash: Buffer;
    responseStatus: number | null;
    responseBody: unknown;
    completedAt: Date | null;
  }>();
  const rpcCalls = { create: 0, update: 0, remove: 0 };
  let verifiedLookups = 0;

  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        assert.deepEqual(values, [userId, 77]);
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Client Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { clients: true },
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        const operation = String(values?.[2]);
        if (!claims.has(operation)) {
          assert.ok(values?.[3] instanceof Buffer);
          assert.ok(values?.[4] instanceof Buffer);
          claims.set(operation, {
            requestHash: values[4] as Buffer,
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
      if (text === CREATE_CLIENT_SQL) {
        rpcCalls.create += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.deepEqual(JSON.parse(String(values?.[1])), {
          name: "Northwind Cooling",
          phone: "+97235550101",
          email: "dispatch@northwind.example",
          city: "Haifa",
          vatNumber: "515987654",
        });
        return result<Row>([clientRow("1")]);
      }
      if (text === UPDATE_CLIENT_SQL) {
        rpcCalls.update += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], clientId);
        assert.equal(values?.[2], "1");
        assert.deepEqual(JSON.parse(String(values?.[3])), {
          name: "Northwind Cooling Ltd.",
          notes: null,
        });
        return result<Row>([clientRow("2", {
          name: "Northwind Cooling Ltd.",
          entity_version: "2",
          updated_at: new Date("2026-07-13T12:05:00.000Z"),
        })]);
      }
      if (text === DELETE_OR_ARCHIVE_CLIENT_SQL) {
        rpcCalls.remove += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], clientId);
        assert.equal(values?.[2], "2");
        return result<Row>([{
          client_id: clientId,
          client_no: 12,
          disposition: "archived",
          entity_version: "3",
          archived_at: new Date("2026-07-13T12:10:00.000Z"),
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        const claimId = String(values?.[0]);
        const operation = claimId.replace(/^claim-/u, "");
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
        accessToken: "client.payload.signature",
      };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerClientMutationRoutes(app, {
    authenticator,
    database,
    firebaseUsers: {
      async getUser(accessToken) {
        verifiedLookups += 1;
        assert.equal(accessToken, "client.payload.signature");
        return {
          userId,
          email: "manager@example.test",
          emailVerified: true,
        };
      },
    },
  });

  const creationRequest = {
    method: "POST" as const,
    url: "/api/v1/companies/77/clients",
    headers: { "idempotency-key": "client-create-key-1234" },
    payload: {
      name: "  Northwind Cooling  ",
      phone: " +97235550101 ",
      email: " DISPATCH@northwind.example ",
      city: " Haifa ",
      vatNumber: " 515987654 ",
    },
  };
  const created = await app.inject(creationRequest);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.headers["cache-control"], "private, no-store");
  assert.equal(created.json().data.entityVersion, encodeEntityVersion(1));
  assert.equal(created.json().data.email, "dispatch@northwind.example");

  const replayed = await app.inject(creationRequest);
  assert.equal(replayed.statusCode, 201, replayed.body);
  assert.deepEqual(replayed.json().data, created.json().data);
  assert.equal(rpcCalls.create, 1);

  const updateRequest = {
    method: "PATCH",
    url: `/api/v1/companies/77/clients/${clientId}`,
    headers: { "idempotency-key": "client-update-key-1234" },
    payload: {
      entityVersion: encodeEntityVersion(1),
      name: " Northwind Cooling Ltd. ",
      notes: null,
    },
  } as const;
  const updated = await app.inject(updateRequest);
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.name, "Northwind Cooling Ltd.");
  assert.equal(updated.json().data.entityVersion, encodeEntityVersion(2));
  const updateReplay = await app.inject(updateRequest);
  assert.equal(updateReplay.statusCode, 200, updateReplay.body);
  assert.deepEqual(updateReplay.json().data, updated.json().data);
  assert.equal(rpcCalls.update, 1);

  const removalRequest = {
    method: "DELETE",
    url: `/api/v1/companies/77/clients/${clientId}`,
    headers: { "idempotency-key": "client-delete-key-1234" },
    payload: { entityVersion: encodeEntityVersion(2) },
  } as const;
  const removed = await app.inject(removalRequest);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(removed.json().data, {
    clientId,
    clientNo: 12,
    disposition: "archived",
    entityVersion: encodeEntityVersion(3),
    archivedAt: "2026-07-13T12:10:00.000Z",
  });
  const removalReplay = await app.inject(removalRequest);
  assert.equal(removalReplay.statusCode, 200, removalReplay.body);
  assert.deepEqual(removalReplay.json().data, removed.json().data);
  assert.deepEqual(rpcCalls, { create: 1, update: 1, remove: 1 });
  assert.equal(verifiedLookups, 6);
});

test("client mutation routes reject missing idempotency before handler work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerClientMutationRoutes(app, {
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
    method: "POST",
    url: "/api/v1/companies/77/clients",
    payload: { name: "Northwind" },
  });
  assert.equal(response.statusCode, 400, response.body);
});

test("client migration exposes only narrow functions and keeps runtime public writes revoked", () => {
  const migration = readFileSync(
    new URL("../../../packages/db/migrations/0000_baseline.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /private\.allocate_company_counter\(p_company_id, 'client_no'\)/);
  assert.match(migration, /membership\.role IN \('manager', 'user', 'basic'\)/);
  assert.match(migration, /CLIENT_MUTATION_FORBIDDEN/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /CLIENT_ENTITY_VERSION_CONFLICT/);
  assert.match(migration, /EXISTS \([\s\S]*FROM public\.jobs[\s\S]*OR EXISTS \([\s\S]*FROM public\.documents/);
  assert.match(migration, /disposition := 'archived'/);
  assert.match(migration, /disposition := 'deleted'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.create_api_client[\s\S]*TO smart_job_api/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.clients TO smart_job_api/i);
});
