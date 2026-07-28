import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type FirebaseTokenVerifier } from "../auth/index.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { encodeEntityVersion, decodeEntityVersion } from "../entities/version.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { registerJobCompletionRoutes } from "../routes/job-completion.js";
import { mapDatabaseError } from "../database/errors.js";
import { AppError } from "../http/errors.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const companyId = "26963503-982a-4552-97d0-45b5fdbfbda9";
const jobId = "9b4f0638-e356-4f78-8981-e94a5c9a484c";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

test("entity versions are opaque, canonical, and bounded", () => {
  const encoded = encodeEntityVersion(42n);
  assert.equal(encoded, "ev1.NDI");
  assert.equal(decodeEntityVersion(encoded), 42n);
  assert.throws(() => decodeEntityVersion("42"));
  assert.throws(() => decodeEntityVersion("ev1.MDQy"));
  assert.throws(() => encodeEntityVersion(0));
});

test("expected completion validation errors map to stable client errors", () => {
  for (const [message, expectedCode] of [
    ["TIME_RANGE_INVALID", "INVALID_JOB_TIME"],
    ["SIGNING_PERSON_INVALID", "INVALID_SIGNING_PERSON"],
    ["TRAVEL_DISTANCE_INVALID", "INVALID_TRAVEL_DISTANCE"],
  ] as const) {
    const mapped = mapDatabaseError({ code: "22023", message });
    assert.ok(mapped instanceof AppError);
    assert.equal(mapped.statusCode, 400);
    assert.equal(mapped.code, expectedCode);
  }
});

test("shared database authorization errors retain their route operation", () => {
  const databaseError = { code: "42501", message: "JOBS_MODULE_DISABLED" };
  const completion = mapDatabaseError(databaseError, "job.complete");
  const creation = mapDatabaseError(databaseError, "job.create");

  assert.ok(completion instanceof AppError);
  assert.equal(completion.code, "JOB_COMPLETION_FORBIDDEN");
  assert.ok(creation instanceof AppError);
  assert.equal(creation.code, "JOB_CREATION_FORBIDDEN");
});

test("transient database concurrency and connection failures are retryable", () => {
  for (const databaseError of [
    { code: "40001", message: "could not serialize access" },
    { code: "40P01", message: "deadlock detected" },
    { code: "08006", message: "connection failure" },
    { code: "57P01", message: "server shutdown" },
  ]) {
    const mapped = mapDatabaseError(databaseError, "job.complete");
    assert.ok(mapped instanceof AppError);
    assert.equal(mapped.statusCode, 503);
    assert.equal(mapped.retryable, true);
  }
});

test("job completion requires idempotency and commits one atomic RPC response", async (context) => {
  const verifier: FirebaseTokenVerifier = {
    issuer: "https://project.firebase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      throw new Error("not used");
    },
    async verifyAccessToken() {
      return { userId, expiresAt: 4_102_444_800 };
    },
  };
  let insertedRequestHash: Buffer | undefined;
  let completionCalls = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text.includes("WITH viewer AS") && text.includes("viewer_membership")) {
        return result<Row>([{
          internal_company_id: companyId,
          public_company_id: "77",
          name: "Completion Workspace",
          account_type: "business",
          role: "worker",
          member_no: 4,
          tier: "Team",
          enabled_modules: {},
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        assert.ok(values?.[3] instanceof Buffer);
        assert.notEqual(String(values?.[3]), "complete-key-1234");
        insertedRequestHash = values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        assert.ok(insertedRequestHash);
        return result<Row>([{
          id: "cbfa3b5c-a585-4439-a382-44ad1808e203",
          request_hash: insertedRequestHash,
          response_status: null,
          response_body: null,
          completed_at: null,
          expires_at: new Date(Date.now() + 60_000),
        }]);
      }
      if (text.includes("private.complete_job_with_details")) {
        completionCalls += 1;
        assert.equal(values?.[0], companyId);
        assert.equal(values?.[1], jobId);
        assert.equal(values?.[2], "1");
        return result<Row>([{
          job_id: jobId,
          job_no: 12,
          status: "finished",
          entity_version: "2",
          finished_at: new Date("2026-07-13T12:00:00.000Z"),
          updated_at: new Date("2026-07-13T12:00:00.000Z"),
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        assert.equal(values?.[1], 200);
        return { rowCount: 1, rows: [] as Row[] };
      }
      throw new Error(`Unexpected SQL in test: ${text.slice(0, 80)}`);
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

  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerJobCompletionRoutes(app, {
    database,
    firebaseUsers: {
      async getUser(accessToken) {
        assert.equal(accessToken, "header.payload.signature");
        return {
          userId,
          email: "worker@example.test",
          emailVerified: true,
        };
      },
    },
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier,
      webSessions: {
        async authenticateSession() {
          throw new Error("Bearer test must not resolve an opaque session");
        },
      },
    }),
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/v1/companies/77/jobs/${jobId}/complete`,
    headers: {
      authorization: "Bearer header.payload.signature",
      "idempotency-key": "complete-key-1234",
      "content-type": "application/json",
    },
    payload: {
      entityVersion: encodeEntityVersion(1),
      timeFrom: "08:00",
      timeTo: "09:00",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(completionCalls, 1);
  assert.deepEqual(response.json(), {
    ok: true,
    data: {
      jobId,
      jobNo: 12,
      status: "finished",
      entityVersion: encodeEntityVersion(2),
      finishedAt: "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
    },
    meta: { requestId: response.headers["x-request-id"] },
  });
});

test("job completion rejects missing idempotency keys before database work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const jwtVerifier: FirebaseTokenVerifier = {
    issuer: "https://project.firebase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      throw new Error("not used");
    },
    async verifyAccessToken() {
      throw new Error("handler must not run when headers are invalid");
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction() {
      throw new Error("database must not run when headers are invalid");
    },
  };
  registerJobCompletionRoutes(app, {
    database,
    firebaseUsers: {
      async getUser() {
        throw new Error("verified-user lookup must not run when headers are invalid");
      },
    },
    authenticator: createApiRequestAuthenticator({
      jwtVerifier,
      webSessions: {
        async authenticateSession() {
          throw new Error("Invalid-header test must not resolve an opaque session");
        },
      },
    }),
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/v1/companies/77/jobs/${jobId}/complete`,
    headers: {
      authorization: "Bearer header.payload.signature",
      "content-type": "application/json",
    },
    payload: { entityVersion: encodeEntityVersion(1) },
  });

  assert.equal(response.statusCode, 400);
});
