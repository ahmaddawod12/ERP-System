import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

import {
  MAX_DATABASE_POOL_SIZE,
  type DatabaseRuntimeConfig,
} from "../runtime-config.js";

export const DEFAULT_TRANSACTION_TIMEOUTS = Object.freeze({
  statementTimeoutMs: 12_000,
  lockTimeoutMs: 3_000,
  idleTransactionTimeoutMs: 15_000,
});

const API_DATABASE_ROLE = "smart_job_api";
export const EXPECTED_DATABASE_SCHEMA_VERSION = "batch6-2026-07-26";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DatabaseQueryResult<Row extends QueryResultRow = QueryResultRow> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}

export interface DatabaseQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseQueryResult<Row>>;
}

export interface DatabasePoolClient extends DatabaseQueryable {
  release(error?: Error | boolean): void;
}

export interface DatabasePool extends DatabaseQueryable {
  readonly totalCount?: number;
  readonly idleCount?: number;
  readonly waitingCount?: number;
  connect(): Promise<DatabasePoolClient>;
  end(): Promise<void>;
}

export interface DatabasePoolSaturationSnapshot {
  readonly reason: "capacity" | "connection_error";
  readonly maxConnections: number;
  readonly totalConnections?: number;
  readonly idleConnections?: number;
  readonly waitingRequests?: number;
}

export interface TransactionTimeouts {
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly idleTransactionTimeoutMs: number;
}

export interface ApiRequestContext {
  readonly userId: string;
  readonly timeouts?: Partial<TransactionTimeouts>;
}

export interface ApiDatabaseRuntime {
  readonly maxConnections: number;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
  withTransaction<T>(
    context: ApiRequestContext,
    work: (transaction: DatabaseQueryable) => Promise<T>,
  ): Promise<T>;
}

export interface WebSessionDatabaseRuntime extends ApiDatabaseRuntime {
  /**
   * Opens a transaction before an opaque token has been mapped to a user.
   * The query facade rejects SQL outside private.web_sessions; authenticated
   * public-schema work must continue to use withTransaction.
   */
  withWebSessionTransaction<T>(
    work: (transaction: DatabaseQueryable) => Promise<T>,
  ): Promise<T>;
}

export interface CreateApiDatabaseRuntimeOptions {
  readonly config?: DatabaseRuntimeConfig;
  readonly pool?: DatabasePool;
  readonly poolFactory?: (config: PoolConfig) => DatabasePool;
  readonly onPoolSaturation?: (snapshot: DatabasePoolSaturationSnapshot) => void;
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseRuntimeClosedError extends Error {
  constructor() {
    super("The database runtime is closed.");
    this.name = "DatabaseRuntimeClosedError";
  }
}

function mutableValues(values?: readonly unknown[]): unknown[] | undefined {
  return values === undefined ? undefined : [...values];
}

function wrapPoolClient(client: PoolClient): DatabasePoolClient {
  return {
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<DatabaseQueryResult<Row>> {
      return client.query<Row>(text, mutableValues(values));
    },
    release(error?: Error | boolean): void {
      client.release(error);
    },
  };
}

function createPgPool(config: PoolConfig): DatabasePool {
  const pool = new Pool(config);
  return {
    get totalCount(): number {
      return pool.totalCount;
    },
    get idleCount(): number {
      return pool.idleCount;
    },
    get waitingCount(): number {
      return pool.waitingCount;
    },
    async connect(): Promise<DatabasePoolClient> {
      return wrapPoolClient(await pool.connect());
    },
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<DatabaseQueryResult<Row>> {
      return pool.query<Row>(text, mutableValues(values));
    },
    end(): Promise<void> {
      return pool.end();
    },
  };
}

function webSessionOnlyQueryable(client: DatabasePoolClient): DatabaseQueryable {
  return {
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<DatabaseQueryResult<Row>> {
      const normalized = text.toLowerCase();
      const qualifiedRelations = [
        ...normalized.matchAll(/\b(public|private)\.([a-z_][a-z0-9_]*)\b/g),
      ];
      const isSingleStatement = !normalized.includes(";");
      const hasRequiredRelation = normalized.includes("private.web_sessions");
      const hasOnlySessionRelations = qualifiedRelations.every(
        (match) => match[1] === "private" && match[2] === "web_sessions",
      );

      if (
        !isSingleStatement
        || !hasRequiredRelation
        || !hasOnlySessionRelations
        || normalized.includes("--")
        || normalized.includes("/*")
      ) {
        throw new DatabaseConfigurationError(
          "An uncontexted web-session transaction may only access private.web_sessions.",
        );
      }
      return client.query<Row>(text, values);
    },
  };
}

function requireApiDatabaseRole(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new DatabaseConfigurationError("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DatabaseConfigurationError("DATABASE_URL must use the PostgreSQL protocol.");
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new DatabaseConfigurationError("DATABASE_URL contains an invalid database role.");
  }

  // Supavisor usernames may append a project reference after the database role.
  const databaseRole = username.split(".", 1)[0]?.trim().toLowerCase();
  if (databaseRole !== API_DATABASE_ROLE) {
    throw new DatabaseConfigurationError(
      `DATABASE_URL must authenticate with the ${API_DATABASE_ROLE} runtime role.`,
    );
  }
}

function resolvePoolSize(configured: number): number {
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new DatabaseConfigurationError("Database maxConnections must be a positive integer.");
  }
  return Math.min(MAX_DATABASE_POOL_SIZE, configured);
}

function boundedTimeout(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveTimeouts(overrides?: Partial<TransactionTimeouts>): TransactionTimeouts {
  return {
    statementTimeoutMs: boundedTimeout(
      overrides?.statementTimeoutMs,
      DEFAULT_TRANSACTION_TIMEOUTS.statementTimeoutMs,
      1_000,
      DEFAULT_TRANSACTION_TIMEOUTS.statementTimeoutMs,
      "statementTimeoutMs",
    ),
    lockTimeoutMs: boundedTimeout(
      overrides?.lockTimeoutMs,
      DEFAULT_TRANSACTION_TIMEOUTS.lockTimeoutMs,
      250,
      DEFAULT_TRANSACTION_TIMEOUTS.lockTimeoutMs,
      "lockTimeoutMs",
    ),
    idleTransactionTimeoutMs: boundedTimeout(
      overrides?.idleTransactionTimeoutMs,
      DEFAULT_TRANSACTION_TIMEOUTS.idleTransactionTimeoutMs,
      1_000,
      DEFAULT_TRANSACTION_TIMEOUTS.idleTransactionTimeoutMs,
      "idleTransactionTimeoutMs",
    ),
  };
}

class PostgresApiDatabaseRuntime implements WebSessionDatabaseRuntime {
  readonly maxConnections: number;
  readonly #pool: DatabasePool;
  readonly #onPoolSaturation: CreateApiDatabaseRuntimeOptions["onPoolSaturation"];
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    pool: DatabasePool,
    maxConnections: number,
    onPoolSaturation?: CreateApiDatabaseRuntimeOptions["onPoolSaturation"],
  ) {
    this.#pool = pool;
    this.maxConnections = maxConnections;
    this.#onPoolSaturation = onPoolSaturation;
  }

  async checkReadiness(): Promise<void> {
    this.#assertOpen();
    const result = await this.#pool.query<{ readonly ready: boolean }>(
      "SELECT private.check_api_readiness($1::text) AS ready",
      [EXPECTED_DATABASE_SCHEMA_VERSION],
    );
    if (result.rows[0]?.ready !== true) {
      throw new DatabaseConfigurationError("The API database schema or RPC grants are not ready.");
    }
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#pool.end();
    return this.#closePromise;
  }

  async withTransaction<T>(
    context: ApiRequestContext,
    work: (transaction: DatabaseQueryable) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    if (!UUID_PATTERN.test(context.userId)) {
      throw new TypeError("userId must be a UUID.");
    }
    const timeouts = resolveTimeouts(context.timeouts);
    const client = await this.#connectClient();
    let transactionStarted = false;
    let discardClient = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        "SELECT private.set_api_request_context($1::uuid, $2::integer, $3::integer, $4::integer)",
        [
          context.userId,
          timeouts.statementTimeoutMs,
          timeouts.lockTimeoutMs,
          timeouts.idleTransactionTimeoutMs,
        ],
      );
      const result = await work(client);
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (cause) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discardClient = true;
        }
      } else {
        discardClient = true;
      }
      throw cause;
    } finally {
      client.release(discardClient ? true : undefined);
    }
  }

  async withWebSessionTransaction<T>(
    work: (transaction: DatabaseQueryable) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    const client = await this.#connectClient();
    let transactionStarted = false;
    let discardClient = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const result = await work(webSessionOnlyQueryable(client));
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (cause) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discardClient = true;
        }
      } else {
        discardClient = true;
      }
      throw cause;
    } finally {
      client.release(discardClient ? true : undefined);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new DatabaseRuntimeClosedError();
  }

  async #connectClient(): Promise<DatabasePoolClient> {
    const atCapacity = this.#pool.idleCount === 0
      && this.#pool.totalCount !== undefined
      && this.#pool.totalCount >= this.maxConnections;
    if (atCapacity || (this.#pool.waitingCount ?? 0) > 0) {
      this.#reportPoolSaturation("capacity");
    }
    try {
      return await this.#pool.connect();
    } catch (error) {
      const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
      const message = error instanceof Error ? error.message : "";
      if (
        code === "53300"
        || /remaining connection slots|too many (?:database )?connections|connection pool[^\r\n]{0,80}(?:full|timeout|timed out)/i.test(message)
      ) {
        this.#reportPoolSaturation("connection_error");
      }
      throw error;
    }
  }

  #reportPoolSaturation(reason: DatabasePoolSaturationSnapshot["reason"]): void {
    try {
      this.#onPoolSaturation?.({
        reason,
        maxConnections: this.maxConnections,
        ...(this.#pool.totalCount === undefined
          ? {}
          : { totalConnections: this.#pool.totalCount }),
        ...(this.#pool.idleCount === undefined
          ? {}
          : { idleConnections: this.#pool.idleCount }),
        ...(this.#pool.waitingCount === undefined
          ? {}
          : { waitingRequests: this.#pool.waitingCount }),
      });
    } catch {
      // Telemetry must never change transaction behavior.
    }
  }
}

export function createApiDatabaseRuntime(
  options: CreateApiDatabaseRuntimeOptions = {},
): WebSessionDatabaseRuntime {
  if (options.pool !== undefined && options.poolFactory !== undefined) {
    throw new DatabaseConfigurationError("Configure either pool or poolFactory, not both.");
  }

  if (options.pool !== undefined) {
    const injectedMax = options.config?.maxConnections ?? MAX_DATABASE_POOL_SIZE;
    return new PostgresApiDatabaseRuntime(
      options.pool,
      resolvePoolSize(injectedMax),
      options.onPoolSaturation,
    );
  }

  if (options.config === undefined) {
    throw new DatabaseConfigurationError("Database runtime configuration is required.");
  }
  requireApiDatabaseRole(options.config.connectionString);
  const maxConnections = resolvePoolSize(options.config.maxConnections);
  const poolConfig: PoolConfig = {
    connectionString: options.config.connectionString,
    application_name: "smart-job-api",
    max: maxConnections,
    idleTimeoutMillis: options.config.idleTimeoutMillis,
    connectionTimeoutMillis: options.config.connectionTimeoutMillis,
    ssl: options.config.ssl,
  };
  const pool = (options.poolFactory ?? createPgPool)(poolConfig);
  return new PostgresApiDatabaseRuntime(pool, maxConnections, options.onPoolSaturation);
}
