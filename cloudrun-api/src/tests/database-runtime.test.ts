import assert from "node:assert/strict";
import test from "node:test";

import type { PoolConfig, QueryResultRow } from "pg";

import {
  DatabaseConfigurationError,
  DatabaseRuntimeClosedError,
  createApiDatabaseRuntime,
  EXPECTED_DATABASE_SCHEMA_VERSION,
  type DatabasePool,
  type DatabasePoolClient,
  type DatabaseQueryResult,
} from "../database/runtime.js";
import { MAX_DATABASE_POOL_SIZE, type DatabaseRuntimeConfig } from "../runtime-config.js";

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

type QueryFailure = (text: string) => Error | undefined;

class FakeClient implements DatabasePoolClient {
  readonly queries: RecordedQuery[] = [];
  readonly releases: (Error | boolean | undefined)[] = [];
  readonly #failure: QueryFailure;

  constructor(failure: QueryFailure = () => undefined) {
    this.#failure = failure;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseQueryResult<Row>> {
    this.queries.push({ text, ...(values === undefined ? {} : { values: [...values] }) });
    const failure = this.#failure(text);
    if (failure !== undefined) throw failure;
    return { rows: [], rowCount: 0 };
  }

  release(error?: Error | boolean): void {
    this.releases.push(error);
  }
}

class FakePool implements DatabasePool {
  readonly queries: RecordedQuery[] = [];
  endCalls = 0;
  readonly #client: FakeClient;

  constructor(client = new FakeClient()) {
    this.#client = client;
  }

  async connect(): Promise<DatabasePoolClient> {
    return this.#client;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseQueryResult<Row>> {
    this.queries.push({ text, ...(values === undefined ? {} : { values: [...values] }) });
    if (text.includes("private.check_api_readiness")) {
      return { rows: [{ ready: true } as unknown as Row], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

const USER_ID = "123e4567-e89b-12d3-a456-426614174000";
const baseConfig: DatabaseRuntimeConfig = {
  connectionString: "postgresql://smart_job_api:local-secret@127.0.0.1:55322/postgres",
  ssl: false,
  maxConnections: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

test("pool configuration caps API instances at five connections", async () => {
  const pools = [new FakePool(), new FakePool()];
  const configurations: PoolConfig[] = [];
  const poolFactory = (config: PoolConfig): DatabasePool => {
    configurations.push(config);
    const pool = pools.shift();
    assert.ok(pool);
    return pool;
  };

  const cappedRuntime = createApiDatabaseRuntime({
    config: { ...baseConfig, maxConnections: 50 },
    poolFactory,
  });
  const smallerRuntime = createApiDatabaseRuntime({
    config: {
      ...baseConfig,
      maxConnections: 3,
      ssl: { rejectUnauthorized: false },
    },
    poolFactory,
  });

  assert.equal(cappedRuntime.maxConnections, MAX_DATABASE_POOL_SIZE);
  assert.equal(smallerRuntime.maxConnections, 3);
  assert.deepEqual(
    configurations.map(({ max, ssl, application_name }) => ({ max, ssl, application_name })),
    [
      { max: 5, ssl: false, application_name: "smart-job-api" },
      {
        max: 3,
        ssl: { rejectUnauthorized: false },
        application_name: "smart-job-api",
      },
    ],
  );
  await Promise.all([cappedRuntime.close(), smallerRuntime.close()]);
});

test("pool saturation is reported without changing transaction behavior", async () => {
  class SaturatedPool extends FakePool {
    readonly totalCount = 5;
    readonly idleCount = 0;
    readonly waitingCount = 2;
  }

  const snapshots: unknown[] = [];
  const runtime = createApiDatabaseRuntime({
    pool: new SaturatedPool(),
    onPoolSaturation: (snapshot) => snapshots.push(snapshot),
  });

  await runtime.withTransaction({ userId: USER_ID }, async () => "committed");

  assert.deepEqual(snapshots, [{
    reason: "capacity",
    maxConnections: MAX_DATABASE_POOL_SIZE,
    totalConnections: 5,
    idleConnections: 0,
    waitingRequests: 2,
  }]);
  await runtime.close();
});

test("runtime refuses migration, admin, and service-role database credentials", () => {
  for (const role of ["postgres", "service_role", "firebase_admin", "worker_role"]) {
    assert.throws(
      () =>
        createApiDatabaseRuntime({
          config: {
            ...baseConfig,
            connectionString: `postgresql://${role}:secret@127.0.0.1:55322/postgres`,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseConfigurationError);
        assert.doesNotMatch(error.message, /secret|127\.0\.0\.1/);
        return true;
      },
    );
  }

  assert.throws(
    () =>
      createApiDatabaseRuntime({
        config: {
          ...baseConfig,
          connectionString: "https://smart_job_api:secret@database.example.test/postgres",
        },
      }),
    DatabaseConfigurationError,
  );
  assert.throws(
    () =>
      createApiDatabaseRuntime({
        config: { ...baseConfig, maxConnections: Number.NaN },
      }),
    DatabaseConfigurationError,
  );
});

test("readiness verifies the exact schema marker and API RPC privilege matrix", async () => {
  const pool = new FakePool();
  const runtime = createApiDatabaseRuntime({ pool });

  await runtime.checkReadiness();

  assert.deepEqual(pool.queries, [{
    text: "SELECT private.check_api_readiness($1::text) AS ready",
    values: [EXPECTED_DATABASE_SCHEMA_VERSION],
  }]);
  await runtime.close();
});

test("transactions set request-local identity and bounded timeouts before application SQL", async () => {
  const client = new FakeClient();
  const runtime = createApiDatabaseRuntime({ pool: new FakePool(client) });

  const result = await runtime.withTransaction(
    {
      userId: USER_ID,
      timeouts: {
        statementTimeoutMs: 60_000,
        lockTimeoutMs: 100,
        idleTransactionTimeoutMs: 5_000,
      },
    },
    async (transaction) => {
      await transaction.query("SELECT current_setting('request.jwt.claim.sub', true)");
      return "committed";
    },
  );

  assert.equal(result, "committed");
  assert.deepEqual(client.queries, [
    { text: "BEGIN" },
    {
      text: "SELECT private.set_api_request_context($1::uuid, $2::integer, $3::integer, $4::integer)",
      values: [USER_ID, 12_000, 250, 5_000],
    },
    { text: "SELECT current_setting('request.jwt.claim.sub', true)" },
    { text: "COMMIT" },
  ]);
  assert.deepEqual(client.releases, [undefined]);
  await runtime.close();
});

test("work errors roll back and remain unchanged", async () => {
  const client = new FakeClient();
  const runtime = createApiDatabaseRuntime({ pool: new FakePool(client) });
  const expected = new Error("domain failure");

  await assert.rejects(
    runtime.withTransaction({ userId: USER_ID }, async () => {
      throw expected;
    }),
    (error: unknown) => error === expected,
  );

  assert.deepEqual(
    client.queries.map(({ text }) => text),
    [
      "BEGIN",
      "SELECT private.set_api_request_context($1::uuid, $2::integer, $3::integer, $4::integer)",
      "ROLLBACK",
    ],
  );
  assert.deepEqual(client.releases, [undefined]);
  await runtime.close();
});

test("a client is discarded if rollback fails without hiding the original error", async () => {
  const rollbackFailure = new Error("connection dropped while rolling back");
  const client = new FakeClient((text) => (text === "ROLLBACK" ? rollbackFailure : undefined));
  const runtime = createApiDatabaseRuntime({ pool: new FakePool(client) });
  const expected = new Error("domain failure");

  await assert.rejects(
    runtime.withTransaction({ userId: USER_ID }, async () => {
      throw expected;
    }),
    (error: unknown) => error === expected,
  );

  assert.deepEqual(client.releases, [true]);
  await runtime.close();
});

test("a client is discarded when BEGIN fails", async () => {
  const beginFailure = new Error("connection unavailable");
  const client = new FakeClient((text) => (text === "BEGIN" ? beginFailure : undefined));
  const runtime = createApiDatabaseRuntime({ pool: new FakePool(client) });

  await assert.rejects(
    runtime.withTransaction({ userId: USER_ID }, async () => "unreachable"),
    (error: unknown) => error === beginFailure,
  );

  assert.deepEqual(client.queries, [{ text: "BEGIN" }]);
  assert.deepEqual(client.releases, [true]);
  await runtime.close();
});

test("invalid identity is rejected before a connection and close is idempotent", async () => {
  const pool = new FakePool();
  const runtime = createApiDatabaseRuntime({ pool });

  await assert.rejects(
    runtime.withTransaction({ userId: "not-a-uuid" }, async () => undefined),
    /userId must be a UUID/,
  );
  await runtime.close();
  await runtime.close();

  assert.equal(pool.endCalls, 1);
  await assert.rejects(runtime.checkReadiness(), DatabaseRuntimeClosedError);
});

test("uncontexted transactions are restricted to private web-session rows", async () => {
  const acceptedClient = new FakeClient();
  const acceptedRuntime = createApiDatabaseRuntime({ pool: new FakePool(acceptedClient) });
  await acceptedRuntime.withWebSessionTransaction((transaction) => transaction.query(
    "SELECT id FROM private.web_sessions WHERE session_token_hash = $1::bytea FOR UPDATE",
    [Buffer.alloc(32)],
  ));
  assert.deepEqual(
    acceptedClient.queries.map(({ text }) => text),
    [
      "BEGIN",
      "SELECT id FROM private.web_sessions WHERE session_token_hash = $1::bytea FOR UPDATE",
      "COMMIT",
    ],
  );
  await acceptedRuntime.close();

  const rejectedClient = new FakeClient();
  const rejectedRuntime = createApiDatabaseRuntime({ pool: new FakePool(rejectedClient) });
  await assert.rejects(
    rejectedRuntime.withWebSessionTransaction((transaction) => transaction.query(
      "SELECT id FROM public.app_users",
    )),
    DatabaseConfigurationError,
  );
  assert.deepEqual(rejectedClient.queries.map(({ text }) => text), ["BEGIN", "ROLLBACK"]);
  await rejectedRuntime.close();
});
