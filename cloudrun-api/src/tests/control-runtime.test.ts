import assert from "node:assert/strict";
import test from "node:test";

import { createControlDatabaseRuntime } from "../database/control-runtime.js";
import type { DatabaseRuntimeConfig } from "../runtime-config.js";

function config(connectionString: string): DatabaseRuntimeConfig {
  return {
    connectionString,
    ssl: false,
    maxConnections: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

test("control runtime refuses tenant, migration, and admin database roles", () => {
  for (const role of ["smart_job_api", "postgres", "smart_job_migrations"]) {
    assert.throws(
      () => createControlDatabaseRuntime(
        config(`postgresql://${role}:secret@127.0.0.1:5432/control`),
      ),
      /smart_job_control_api/,
    );
  }
});

test("control runtime rejects non-PostgreSQL connection URLs", () => {
  assert.throws(
    () => createControlDatabaseRuntime(config("https://database.example.test")),
    /PostgreSQL protocol/,
  );
});
