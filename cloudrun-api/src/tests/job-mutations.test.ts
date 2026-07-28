import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { buildApp } from "../app.js";
import type { ApiRequestAuthenticator } from "../auth/index.js";
import { loadConfig } from "../config.js";
import { mapDatabaseError } from "../database/errors.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { AppError } from "../http/errors.js";
import {
  ACCEPT_JOB_SQL,
  DELETE_JOB_SQL,
  UPDATE_JOB_SQL,
} from "../jobs/mutation-repository.js";
import { registerJobMutationRoutes } from "../routes/job-mutations.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const internalCompanyId = "26963503-982a-4552-97d0-45b5fdbfbda9";
const jobId = "9b4f0638-e356-4f78-8981-e94a5c9a484c";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function jobRow(
  status: "pending" | "waiting" | "finished" | "denied",
  entityVersion: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    job_id: jobId,
    job_no: 12,
    status,
    title: "Emergency relay repair",
    description: "Replace the damaged relay",
    notes: null,
    location: "Haifa",
    address: null,
    category: null,
    priority: "urgent",
    due_at: null,
    client_id: null,
    client_name: null,
    client_phone: null,
    assignee_member_no: 4,
    assignee_display_name: "Field Worker",
    creator_uid: userId,
    creator_member_no: 1,
    creator_display_name: "Manager",
    is_certificate: false,
    meta: {},
    entity_version: entityVersion,
    created_at: new Date("2026-07-13T10:00:00.000Z"),
    updated_at: new Date("2026-07-13T12:00:00.000Z"),
    finished_at: null,
    denied_at: null,
    ...overrides,
  };
}

test("job update, accept, and delete share verified idempotent RPC boundaries", async (context) => {
  const claims = new Map<string, {
    requestHash: Buffer;
    responseStatus: number | null;
    responseBody: unknown;
    completedAt: Date | null;
  }>();
  const rpcCalls = { update: 0, accept: 0, delete: 0 };
  let verifiedLookups = 0;
  let transactionCount = 0;

  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        assert.deepEqual(values, [userId, 77]);
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Job Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { solojob: true },
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
      if (text === UPDATE_JOB_SQL) {
        rpcCalls.update += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], jobId);
        assert.equal(values?.[2], "1");
        assert.deepEqual(JSON.parse(String(values?.[3])), {
          title: "Emergency relay repair",
          notes: null,
          status: "waiting",
        });
        assert.ok(values?.[4] instanceof Date);
        return result<Row>([jobRow("waiting", "2")]);
      }
      if (text === ACCEPT_JOB_SQL) {
        rpcCalls.accept += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], jobId);
        assert.equal(values?.[2], "2");
        assert.ok(values?.[3] instanceof Date);
        return result<Row>([jobRow("finished", "3", {
          finished_at: new Date("2026-07-13T12:05:00.000Z"),
          updated_at: new Date("2026-07-13T12:05:00.000Z"),
        })]);
      }
      if (text === DELETE_JOB_SQL) {
        rpcCalls.delete += 1;
        assert.deepEqual(values, [internalCompanyId, jobId, "3"]);
        return result<Row>([{ job_id: jobId, job_no: 12, deleted: true }]);
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
      transactionCount += 1;
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
        accessToken: "job.payload.signature",
      };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerJobMutationRoutes(app, {
    authenticator,
    database,
    firebaseUsers: {
      async getUser(accessToken) {
        verifiedLookups += 1;
        assert.equal(accessToken, "job.payload.signature");
        return {
          userId,
          email: "manager@example.test",
          emailVerified: true,
        };
      },
    },
  });

  const updateRequest = {
    method: "PATCH" as const,
    url: `/api/v1/companies/77/jobs/${jobId}`,
    headers: { "idempotency-key": "job-update-key-1234" },
    payload: {
      entityVersion: encodeEntityVersion(1),
      title: "  Emergency relay repair  ",
      notes: null,
      status: "waiting",
    },
  };
  const updated = await app.inject(updateRequest);
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.headers["cache-control"], "private, no-store");
  assert.equal(updated.json().data.entityVersion, encodeEntityVersion(2));
  const updateReplay = await app.inject(updateRequest);
  assert.equal(updateReplay.statusCode, 200, updateReplay.body);
  assert.deepEqual(updateReplay.json().data, updated.json().data);

  const acceptRequest = {
    method: "POST" as const,
    url: `/api/v1/companies/77/jobs/${jobId}/accept`,
    headers: { "idempotency-key": "job-accept-key-1234" },
    payload: { entityVersion: encodeEntityVersion(2) },
  };
  const accepted = await app.inject(acceptRequest);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().data.status, "finished");
  assert.equal(accepted.json().data.entityVersion, encodeEntityVersion(3));
  const acceptReplay = await app.inject(acceptRequest);
  assert.deepEqual(acceptReplay.json().data, accepted.json().data);

  const deleteRequest = {
    method: "DELETE" as const,
    url: `/api/v1/companies/77/jobs/${jobId}`,
    headers: { "idempotency-key": "job-delete-key-1234" },
    payload: { entityVersion: encodeEntityVersion(3) },
  };
  const deleted = await app.inject(deleteRequest);
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.deepEqual(deleted.json().data, { jobId, jobNo: 12, deleted: true });
  const deleteReplay = await app.inject(deleteRequest);
  assert.deepEqual(deleteReplay.json().data, deleted.json().data);

  assert.deepEqual(rpcCalls, { update: 1, accept: 1, delete: 1 });
  assert.equal(transactionCount, 6, "each request owns exactly one transaction");
  assert.equal(verifiedLookups, 6);
});

test("job mutation schemas reject missing keys, direct finish, and legacy authority fields", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerJobMutationRoutes(app, {
    authenticator: {
      async authenticate() {
        throw new Error("invalid requests must not reach authentication");
      },
    },
    database: {
      maxConnections: 1,
      async checkReadiness() {},
      async close() {},
      async withTransaction() {
        throw new Error("invalid requests must not reach the database");
      },
    },
    firebaseUsers: {
      async getUser() {
        throw new Error("invalid requests must not verify users");
      },
    },
  });

  const missingKey = await app.inject({
    method: "PATCH",
    url: `/api/v1/companies/77/jobs/${jobId}`,
    payload: { entityVersion: encodeEntityVersion(1), title: "Updated" },
  });
  assert.equal(missingKey.statusCode, 400, missingKey.body);

  for (const payload of [
    { entityVersion: encodeEntityVersion(1) },
    { entityVersion: encodeEntityVersion(1), status: "finished" },
    { entityVersion: encodeEntityVersion(1), assignedTo: userId },
    { entityVersion: encodeEntityVersion(1), workerId: userId },
  ]) {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/companies/77/jobs/${jobId}`,
      headers: { "idempotency-key": "job-invalid-key-1234" },
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});

test("job mutation database failures map to route-specific conflicts and authorization errors", () => {
  const stale = mapDatabaseError(
    { code: "40001", message: "ENTITY_VERSION_CONFLICT" },
    "job.update",
  );
  const acceptState = mapDatabaseError(
    { code: "22023", message: "JOB_NOT_ACCEPTABLE" },
    "job.accept",
  );
  const deleteReference = mapDatabaseError(
    { code: "23503", message: "JOB_HAS_LINKED_DOCUMENTS" },
    "job.delete",
  );
  const forbidden = mapDatabaseError(
    { code: "42501", message: "JOB_NOT_ASSIGNED_TO_VIEWER" },
    "job.delete",
  );

  for (const mapped of [stale, acceptState, deleteReference, forbidden]) {
    assert.ok(mapped instanceof AppError);
  }
  assert.deepEqual(
    [
      (stale as AppError).statusCode,
      (acceptState as AppError).statusCode,
      (deleteReference as AppError).statusCode,
      (forbidden as AppError).statusCode,
    ],
    [409, 409, 409, 403],
  );
  assert.equal((forbidden as AppError).code, "JOB_DELETE_FORBIDDEN");
});

test("job mutation migration exposes only narrow, versioned transaction functions", () => {
  const migration = readFileSync(
    new URL("../../../packages/db/migrations/0000_baseline.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /private\.get_company_module_entitlements\(p_company_id\)/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /ENTITY_VERSION_CONFLICT/);
  assert.match(migration, /JOB_DIRECT_FINISH_FORBIDDEN/);
  assert.match(migration, /JOB_HAS_LINKED_DOCUMENTS/);
  assert.match(migration, /JOB_HAS_INVENTORY_MOVEMENTS/);
  assert.match(migration, /JOB_HAS_ATTACHMENTS/);
  assert.match(migration, /JOB_HAS_UPLOAD_SESSION/);
  assert.match(migration, /private\.bump_company_sync_version\(p_company_id, 'jobs_version'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.update_api_job[\s\S]*TO smart_job_api/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.jobs TO smart_job_api/i);
});
