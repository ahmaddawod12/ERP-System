import { Pool, type PoolConfig, type QueryResultRow } from "pg";

import type { DatabaseRuntimeConfig } from "../runtime-config.js";
import type {
  ControlDirectoryDatabase,
  TenantRouteDirectory,
} from "./shard-router.js";
import { createPostgresTenantRouteDirectory } from "./shard-router.js";

export const EXPECTED_CONTROL_SCHEMA_VERSION = "control-1-2026-07-28";
const CONTROL_DATABASE_ROLE = "smart_job_control_api";
const MAX_CONTROL_POOL_SIZE = 3;

export interface ControlDatabaseRuntime extends ControlDirectoryDatabase {
  readonly directory: TenantRouteDirectory;
  close(): Promise<void>;
}

function requireControlRole(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new TypeError("CONTROL_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new TypeError("CONTROL_DATABASE_URL must use the PostgreSQL protocol.");
  }
  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new TypeError("CONTROL_DATABASE_URL contains an invalid database role.");
  }
  if (username.split(".", 1)[0]?.trim().toLowerCase() !== CONTROL_DATABASE_ROLE) {
    throw new TypeError(
      `CONTROL_DATABASE_URL must authenticate as ${CONTROL_DATABASE_ROLE}.`,
    );
  }
}

export function createControlDatabaseRuntime(
  config: DatabaseRuntimeConfig,
): ControlDatabaseRuntime {
  requireControlRole(config.connectionString);
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: "smart-job-control-api",
    max: Math.min(MAX_CONTROL_POOL_SIZE, config.maxConnections),
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.ssl,
  };
  const pool = new Pool(poolConfig);
  const database: ControlDirectoryDatabase = {
    async query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) {
      return pool.query<Row>(text, values === undefined ? undefined : [...values]);
    },
    async checkReadiness() {
      const result = await pool.query<{ ready: boolean }>(
        "SELECT private.check_control_readiness($1::text) AS ready",
        [EXPECTED_CONTROL_SCHEMA_VERSION],
      );
      if (result.rows[0]?.ready !== true) {
        throw new Error("The control database schema is not ready.");
      }
    },
  };
  return {
    ...database,
    directory: createPostgresTenantRouteDirectory(database),
    close: () => pool.end(),
  };
}
