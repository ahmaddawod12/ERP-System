import type { QueryResultRow } from "pg";

import type { DatabaseRuntimeConfig } from "../runtime-config.js";
import {
  createApiDatabaseRuntime,
  type ApiDatabaseRuntime,
  type ApiRequestContext,
  type DatabaseQueryable,
} from "./runtime.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARD_ID_PATTERN = /^[a-z][a-z0-9-]{2,62}$/;
const DEFAULT_ROUTE_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_ROUTE_CACHE_ENTRIES = 10_000;

export interface TenantRoute {
  readonly companyUuid: string;
  readonly publicCompanyId: number;
  readonly shardId: string;
  readonly role: "manager" | "worker" | "user" | "basic" | "dev";
  readonly routingVersion: number;
}

export interface TenantRouteDirectory {
  resolveCompanyRoute(
    publicCompanyId: number,
    userId: string,
  ): Promise<TenantRoute | null>;
}

export interface TenantShardConfig {
  readonly shardId: string;
  readonly database: DatabaseRuntimeConfig;
}

export interface TenantTransactionContext extends ApiRequestContext {
  readonly publicCompanyId: number;
}

export interface ResolvedTenantTransaction {
  readonly route: TenantRoute;
  readonly transaction: DatabaseQueryable;
}

export interface TenantShardRouter {
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
  resolve(context: TenantTransactionContext): Promise<{
    readonly route: TenantRoute;
    readonly database: ApiDatabaseRuntime;
  }>;
  withTenantTransaction<T>(
    context: TenantTransactionContext,
    work: (resolved: ResolvedTenantTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface CreateTenantShardRouterOptions {
  readonly directory: TenantRouteDirectory;
  readonly shards: readonly TenantShardConfig[];
  readonly routeCacheTtlMs?: number;
  readonly maxRouteCacheEntries?: number;
  readonly now?: () => number;
  readonly createRuntime?: (
    config: DatabaseRuntimeConfig,
    shardId: string,
  ) => ApiDatabaseRuntime;
}

export class TenantRouteNotFoundError extends Error {
  constructor() {
    super("The requested company is unavailable or the user is not an active member.");
    this.name = "TenantRouteNotFoundError";
  }
}

export class TenantShardUnavailableError extends Error {
  readonly shardId: string;

  constructor(shardId: string) {
    super("The company database shard is unavailable.");
    this.name = "TenantShardUnavailableError";
    this.shardId = shardId;
  }
}

interface CachedRoute {
  readonly route: TenantRoute;
  readonly expiresAt: number;
}

function validPublicCompanyId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function cacheKey(publicCompanyId: number, userId: string): string {
  return `${userId}:${publicCompanyId}`;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return resolved;
}

export function createTenantShardRouter(
  options: CreateTenantShardRouterOptions,
): TenantShardRouter {
  const routeCacheTtlMs = positiveInteger(
    options.routeCacheTtlMs,
    DEFAULT_ROUTE_CACHE_TTL_MS,
    "routeCacheTtlMs",
  );
  const maxRouteCacheEntries = positiveInteger(
    options.maxRouteCacheEntries,
    DEFAULT_MAX_ROUTE_CACHE_ENTRIES,
    "maxRouteCacheEntries",
  );
  const now = options.now ?? Date.now;
  const shardConfigs = new Map<string, DatabaseRuntimeConfig>();
  for (const shard of options.shards) {
    if (!SHARD_ID_PATTERN.test(shard.shardId)) {
      throw new TypeError(`Invalid tenant shard ID: ${shard.shardId}`);
    }
    if (shardConfigs.has(shard.shardId)) {
      throw new TypeError(`Duplicate tenant shard ID: ${shard.shardId}`);
    }
    shardConfigs.set(shard.shardId, shard.database);
  }
  if (shardConfigs.size === 0) {
    throw new TypeError("At least one tenant shard must be configured.");
  }

  const routeCache = new Map<string, CachedRoute>();
  const runtimes = new Map<string, ApiDatabaseRuntime>();
  let closed = false;

  const runtimeFor = (shardId: string): ApiDatabaseRuntime => {
    const existing = runtimes.get(shardId);
    if (existing !== undefined) return existing;
    const config = shardConfigs.get(shardId);
    if (config === undefined) throw new TenantShardUnavailableError(shardId);
    const runtime = options.createRuntime?.(config, shardId)
      ?? createApiDatabaseRuntime({ config });
    runtimes.set(shardId, runtime);
    return runtime;
  };

  const resolve = async (context: TenantTransactionContext) => {
    if (closed) throw new Error("The tenant shard router is closed.");
    if (!UUID_PATTERN.test(context.userId)) {
      throw new TypeError("userId must be a UUID.");
    }
    if (!validPublicCompanyId(context.publicCompanyId)) {
      throw new TypeError("publicCompanyId must be a positive safe integer.");
    }

    const key = cacheKey(context.publicCompanyId, context.userId);
    const cached = routeCache.get(key);
    if (cached !== undefined && cached.expiresAt > now()) {
      return { route: cached.route, database: runtimeFor(cached.route.shardId) };
    }
    routeCache.delete(key);
    const route = await options.directory.resolveCompanyRoute(
      context.publicCompanyId,
      context.userId,
    );
    if (route === null) throw new TenantRouteNotFoundError();
    if (
      route.publicCompanyId !== context.publicCompanyId
      || !UUID_PATTERN.test(route.companyUuid)
      || !SHARD_ID_PATTERN.test(route.shardId)
      || !Number.isSafeInteger(route.routingVersion)
      || route.routingVersion <= 0
    ) {
      throw new TenantShardUnavailableError(route.shardId);
    }
    if (routeCache.size >= maxRouteCacheEntries) {
      const oldestKey = routeCache.keys().next().value;
      if (typeof oldestKey === "string") routeCache.delete(oldestKey);
    }
    routeCache.set(key, { route, expiresAt: now() + routeCacheTtlMs });
    return { route, database: runtimeFor(route.shardId) };
  };

  return {
    async checkReadiness() {
      await Promise.all([...shardConfigs.keys()].map(
        (shardId) => runtimeFor(shardId).checkReadiness(),
      ));
    },

    async close() {
      if (closed) return;
      closed = true;
      routeCache.clear();
      await Promise.all([...runtimes.values()].map((runtime) => runtime.close()));
      runtimes.clear();
    },

    resolve,

    async withTenantTransaction(context, work) {
      const resolved = await resolve(context);
      return resolved.database.withTransaction(context, async (transaction) => work({
        route: resolved.route,
        transaction,
      }));
    },
  };
}

export interface ControlDirectoryDatabase extends DatabaseQueryable {
  checkReadiness?(): Promise<void>;
}

interface RouteRow extends QueryResultRow {
  readonly company_uuid: string;
  readonly shard_id: string;
  readonly role: TenantRoute["role"];
  readonly routing_version: string | number;
}

export function createPostgresTenantRouteDirectory(
  database: ControlDirectoryDatabase,
): TenantRouteDirectory {
  return {
    async resolveCompanyRoute(publicCompanyId, userId) {
      const result = await database.query<RouteRow>(
        `SELECT company_uuid, shard_id, role, routing_version
         FROM private.resolve_company_route($1::bigint, $2::uuid)`,
        [publicCompanyId, userId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const routingVersion = Number(row.routing_version);
      return {
        companyUuid: row.company_uuid,
        publicCompanyId,
        shardId: row.shard_id,
        role: row.role,
        routingVersion,
      };
    },
  };
}
