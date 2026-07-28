import assert from "node:assert/strict";
import test from "node:test";

import {
  createTenantShardRouter,
  TenantRouteNotFoundError,
  TenantShardUnavailableError,
  type TenantRouteDirectory,
} from "../database/shard-router.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import type { DatabaseRuntimeConfig } from "../runtime-config.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COMPANY_UUID = "00000000-0000-4000-8000-000000000002";
const databaseConfig: DatabaseRuntimeConfig = {
  connectionString: "postgresql://smart_job_api:test@db.example.test/postgres",
  ssl: false,
  maxConnections: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

function fakeRuntime(events: string[]): ApiDatabaseRuntime {
  return {
    maxConnections: 2,
    async checkReadiness() {
      events.push("ready");
    },
    async close() {
      events.push("close");
    },
    async withTransaction(context, work) {
      events.push(`transaction:${context.userId}`);
      return work({
        async query() {
          return { rows: [], rowCount: 0 };
        },
      } satisfies DatabaseQueryable);
    },
  };
}

test("tenant router resolves membership, lazily opens the shard, and caches briefly", async () => {
  let directoryCalls = 0;
  let now = 1_000;
  const events: string[] = [];
  const directory: TenantRouteDirectory = {
    async resolveCompanyRoute(publicCompanyId) {
      directoryCalls += 1;
      return {
        companyUuid: COMPANY_UUID,
        publicCompanyId,
        shardId: "shard-001",
        role: "manager",
        routingVersion: 4,
      };
    },
  };
  const created: string[] = [];
  const router = createTenantShardRouter({
    directory,
    shards: [{ shardId: "shard-001", database: databaseConfig }],
    routeCacheTtlMs: 100,
    now: () => now,
    createRuntime(_config, shardId) {
      created.push(shardId);
      return fakeRuntime(events);
    },
  });

  const first = await router.withTenantTransaction(
    { userId: USER_ID, publicCompanyId: 42 },
    async ({ route }) => route,
  );
  const second = await router.resolve({ userId: USER_ID, publicCompanyId: 42 });

  assert.equal(first.companyUuid, COMPANY_UUID);
  assert.equal(second.route.routingVersion, 4);
  assert.equal(directoryCalls, 1);
  assert.deepEqual(created, ["shard-001"]);
  assert.deepEqual(events, [`transaction:${USER_ID}`]);

  now += 101;
  await router.resolve({ userId: USER_ID, publicCompanyId: 42 });
  assert.equal(directoryCalls, 2);
  await router.close();
  assert.deepEqual(events, [`transaction:${USER_ID}`, "close"]);
});

test("tenant router denies missing memberships before opening a shard", async () => {
  const router = createTenantShardRouter({
    directory: {
      async resolveCompanyRoute() {
        return null;
      },
    },
    shards: [{ shardId: "shard-001", database: databaseConfig }],
    createRuntime() {
      throw new Error("runtime must not be opened");
    },
  });

  await assert.rejects(
    router.resolve({ userId: USER_ID, publicCompanyId: 42 }),
    TenantRouteNotFoundError,
  );
});

test("tenant router fails closed when control data names an unconfigured shard", async () => {
  const router = createTenantShardRouter({
    directory: {
      async resolveCompanyRoute(publicCompanyId) {
        return {
          companyUuid: COMPANY_UUID,
          publicCompanyId,
          shardId: "shard-999",
          role: "worker",
          routingVersion: 1,
        };
      },
    },
    shards: [{ shardId: "shard-001", database: databaseConfig }],
  });

  await assert.rejects(
    router.resolve({ userId: USER_ID, publicCompanyId: 42 }),
    TenantShardUnavailableError,
  );
});
