import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
  ApiRequestAuthenticator,
  SupabaseUserClient,
} from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import { hashIdempotencyRequest } from "../idempotency/repository.js";
import { registerUploadSessionRoutes } from "../routes/upload-sessions.js";
import type { CompanyFileStorage } from "../storage/company-files.js";

const userId = "098dd581-9202-4bec-9697-f944b3cc9f0e";
const internalCompanyId = "65fc9a06-30e5-4b4b-8864-463205368292";
const attachmentId = "b78347f7-22ad-45d2-92f7-29b93d34b7d6";
const accessToken = "header.payload.signature";
const bucketId = "smart-job-company-files";
const idempotencyKey = "upload-session-key-1234";
const claimId = "1329df73-78bf-4e46-bf3b-489214ee5eb7";
const payload = {
  companyId: 42,
  purpose: "job.create_finished",
  attachments: [{
    attachmentId,
    kind: "photo",
    fileName: "field-photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    sha256: createHash("sha256").update("0123456789").digest("hex"),
  }],
} as const;

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function bearerAuthenticator(): ApiRequestAuthenticator {
  return {
    async authenticate() {
      return {
        scheme: "bearer",
        userId,
        expiresAt: 4_102_444_800,
        accessToken,
      };
    },
  };
}

function supabaseUsers(emailVerified: boolean): SupabaseUserClient {
  return {
    async getUser(token) {
      assert.equal(token, accessToken);
      return {
        userId,
        email: "field@example.test",
        emailVerified,
      };
    },
  };
}

function createDatabase(options: {
  readonly expiresAt?: Date;
  readonly preparationOutcome?: "rate_limited" | "quota_exceeded";
} = {}) {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  let transactionCalls = 0;
  let completed = false;
  let responseBody: unknown = null;
  let responseStatus: number | null = null;
  let sessionExists = false;
  let sessionStatus = "pending";
  let signingFailures = 0;
  let expiresAt = options.expiresAt ?? new Date(Date.now() + 119 * 60_000);
  let manifest: unknown[] = [];
  const requestHash = hashIdempotencyRequest({ body: payload });
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) {
      queries.push({ text, ...(values === undefined ? {} : { values }) });
      if (text.includes("WITH viewer AS") && text.includes("viewer_membership")) {
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "42",
          name: "Upload Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: {},
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        return result<Row>([{
          id: claimId,
          request_hash: requestHash,
          response_status: responseStatus,
          response_body: responseBody,
          completed_at: completed ? new Date() : null,
          expires_at: new Date(Date.now() + 24 * 60 * 60_000),
        }]);
      }
      if (text.includes("private.prepare_api_file_upload_session")) {
        if (options.preparationOutcome) {
          return result<Row>([{
            outcome: options.preparationOutcome,
            session_id: claimId,
            session_expires_at: null,
            session_signing_failures: 0,
            rate_limit_reset_at: options.preparationOutcome === "rate_limited"
              ? new Date(Date.now() + 10 * 60_000)
              : null,
          }]);
        }
        if (sessionExists && sessionStatus !== "pending") {
          return result<Row>([{
            outcome: "unavailable",
            session_id: claimId,
            session_expires_at: expiresAt,
            session_signing_failures: signingFailures,
            rate_limit_reset_at: null,
          }]);
        }
        const outcome = sessionExists ? "reused" : "created";
        sessionExists = true;
        expiresAt = outcome === "created" ? values?.[7] as Date : expiresAt;
        manifest = JSON.parse(String(values?.[6])) as unknown[];
        return result<Row>([{
          outcome,
          session_id: claimId,
          session_expires_at: expiresAt,
          session_signing_failures: signingFailures,
          rate_limit_reset_at: new Date(Date.now() + 10 * 60_000),
        }]);
      }
      if (text.includes("FROM private.file_upload_sessions")) {
        if (!sessionExists || sessionStatus !== "pending") return result<Row>([]);
        return result<Row>([{
          id: claimId,
          purpose: payload.purpose,
          target_job_id: null,
          expected_manifest: manifest,
          expires_at: expiresAt,
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        responseStatus = Number(values?.[1]);
        responseBody = JSON.parse(String(values?.[2]));
        completed = true;
        return { rowCount: 1, rows: [] } as DatabaseQueryResult<Row>;
      }
      if (text.includes("private.record_api_file_upload_signing_failure")) {
        signingFailures = Math.min(signingFailures + 1, 3);
        sessionStatus = signingFailures >= 3 ? "cleanup_pending" : "pending";
        return result<Row>([{
          session_status: sessionStatus,
          failure_count: signingFailures,
        }]);
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 80)}`);
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      transactionCalls += 1;
      assert.equal(context.userId, userId);
      return work(transaction);
    },
  };
  return {
    database,
    queries,
    transactionCalls: () => transactionCalls,
    completedResponse: () => responseBody,
    signingFailures: () => signingFailures,
    setExpiresAt(value: Date) {
      expiresAt = value;
    },
  };
}

function successfulStorage(): CompanyFileStorage {
  return {
    async createSignedUploadTargets(attachments) {
      return attachments.map((attachment) => ({
        ...attachment,
        uploadUrl:
          `https://project.supabase.co/storage/v1/object/upload/sign/${bucketId}`
          + `/${attachment.objectPath}?token=signed-token`,
        requiredHeaders: {
          "cache-control": "max-age=3600",
          "content-type": attachment.mimeType,
          "x-upsert": "false",
        },
      }));
    },
    async verifyUploadedAttachments() {
      throw new Error("verification was not expected during session creation");
    },
    async removeObjects() {
      throw new Error("object removal was not expected during session creation");
    },
  };
}

test("upload-session route requires an Idempotency-Key before database work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: successfulStorage(),
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: { authorization: `Bearer ${accessToken}` },
    payload,
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(database.transactionCalls(), 0);
});

test("upload-session route requires a verified bearer identity before database work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  let storageCalls = 0;
  const storage = successfulStorage();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      ...storage,
      async createSignedUploadTargets(attachments) {
        storageCalls += 1;
        return storage.createSignedUploadTargets(attachments);
      },
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(false),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(database.transactionCalls(), 0);
  assert.equal(storageCalls, 0);
});

test("upload-session route creates signed, tenant-owned upload targets", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  let signedObjectPath: string | undefined;
  const storage = successfulStorage();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      ...storage,
      async createSignedUploadTargets(attachments) {
        signedObjectPath = attachments[0]?.objectPath;
        return storage.createSignedUploadTargets(attachments);
      },
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  });

  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.companyId, 42);
  assert.equal(body.data.jobId, null);
  assert.match(body.data.uploadSessionId, /^[0-9a-f-]{36}$/);
  assert.equal(
    signedObjectPath,
    `${internalCompanyId}/${userId}/${body.data.uploadSessionId}/${attachmentId}.jpg`,
  );
  assert.equal(body.data.attachments[0].objectPath, signedObjectPath);
  assert.equal(body.data.attachments[0].requiredHeaders["x-upsert"], "false");
  assert.equal(database.transactionCalls(), 2);
  assert.equal(
    database.queries.filter(({ text }) =>
      text.includes("private.prepare_api_file_upload_session")
    ).length,
    1,
  );
  assert.equal(JSON.stringify(database.completedResponse()).includes("uploadUrl"), false);
});

test("idempotent replay reuses one session and creates a fresh signed URL", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  let signingCalls = 0;
  const storage = successfulStorage();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      ...storage,
      async createSignedUploadTargets(attachments) {
        signingCalls += 1;
        const targets = await storage.createSignedUploadTargets(attachments);
        return targets.map((target) => ({
          ...target,
          uploadUrl: `${target.uploadUrl}&generation=${signingCalls}`,
        }));
      },
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });

  const request = {
    method: "POST" as const,
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  };
  const first = await app.inject(request);
  const replay = await app.inject(request);

  assert.equal(first.statusCode, 201, first.body);
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(first.json().data.uploadSessionId, claimId);
  assert.equal(replay.json().data.uploadSessionId, claimId);
  assert.notEqual(
    first.json().data.attachments[0].uploadUrl,
    replay.json().data.attachments[0].uploadUrl,
  );
  assert.equal(signingCalls, 2);
  assert.equal(
    database.queries.filter(({ text }) =>
      text.includes("private.prepare_api_file_upload_session")
    ).length,
    1,
  );
  assert.equal(database.transactionCalls(), 3);
  assert.equal(JSON.stringify(database.completedResponse()).includes("uploadUrl"), false);
});

test("completed replay refuses a session inside the expiry safety window", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  let signingCalls = 0;
  const storage = successfulStorage();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      ...storage,
      async createSignedUploadTargets(attachments) {
        signingCalls += 1;
        return storage.createSignedUploadTargets(attachments);
      },
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });
  const request = {
    method: "POST" as const,
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  };

  const first = await app.inject(request);
  assert.equal(first.statusCode, 201, first.body);
  database.setExpiresAt(new Date(Date.now() + 30_000));
  const replay = await app.inject(request);

  assert.equal(replay.statusCode, 409, replay.body);
  assert.equal(replay.json().error.code, "UPLOAD_SESSION_EXPIRED");
  assert.equal(signingCalls, 1);
});

test("upload rate and active-session quota denials commit before HTTP 429", async (context) => {
  for (const fixture of [
    {
      outcome: "rate_limited" as const,
      code: "UPLOAD_SESSION_RATE_LIMITED",
    },
    {
      outcome: "quota_exceeded" as const,
      code: "UPLOAD_SESSION_QUOTA_EXCEEDED",
    },
  ]) {
    await context.test(fixture.outcome, async (subtest) => {
      const app = await buildApp({ config: loadConfig({}), logger: false });
      subtest.after(() => app.close());
      const database = createDatabase({ preparationOutcome: fixture.outcome });
      let storageCalls = 0;
      const storage = successfulStorage();
      registerUploadSessionRoutes(app, {
        authenticator: bearerAuthenticator(),
        database: database.database,
        storage: {
          ...storage,
          async createSignedUploadTargets(attachments) {
            storageCalls += 1;
            return storage.createSignedUploadTargets(attachments);
          },
        },
        storageBucketId: bucketId,
        supabaseUsers: supabaseUsers(true),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/uploads/job-attachments/sessions",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "idempotency-key": idempotencyKey,
        },
        payload,
      });

      assert.equal(response.statusCode, 429, response.body);
      assert.equal(response.json().error.code, fixture.code);
      assert.equal(response.json().error.retryable, true);
      assert.equal(database.transactionCalls(), 1);
      assert.equal(storageCalls, 0);
    });
  }
});

test("signed-URL failures retain the deterministic session for bounded retry", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      async createSignedUploadTargets() {
        throw new AppError({
          statusCode: 503,
          code: "STORAGE_UNAVAILABLE",
          message: "File storage is temporarily unavailable.",
          retryable: true,
        });
      },
      async verifyUploadedAttachments() {},
      async removeObjects() {},
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().error.code, "STORAGE_UNAVAILABLE");
  assert.equal(response.json().error.retryable, true);
  assert.equal(database.transactionCalls(), 2);
  const prepare = database.queries.find(({ text }) =>
    text.includes("private.prepare_api_file_upload_session")
  );
  const failure = database.queries.find(({ text }) =>
    text.includes("private.record_api_file_upload_signing_failure")
  );
  assert.ok(prepare);
  assert.ok(failure);
  assert.equal(failure.values?.[0], claimId);
  assert.equal(database.signingFailures(), 1);
});

test("three initial signing failures queue cleanup and stop signing the same claim", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = createDatabase();
  let signingCalls = 0;
  registerUploadSessionRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    storage: {
      async createSignedUploadTargets() {
        signingCalls += 1;
        throw new AppError({
          statusCode: 503,
          code: "STORAGE_UNAVAILABLE",
          message: "File storage is temporarily unavailable.",
          retryable: true,
        });
      },
      async verifyUploadedAttachments() {},
      async removeObjects() {},
    },
    storageBucketId: bucketId,
    supabaseUsers: supabaseUsers(true),
  });
  const request = {
    method: "POST" as const,
    url: "/api/v1/uploads/job-attachments/sessions",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 503, response.body);
  }
  const exhausted = await app.inject(request);

  assert.equal(exhausted.statusCode, 409, exhausted.body);
  assert.equal(exhausted.json().error.code, "UPLOAD_SESSION_UNAVAILABLE");
  assert.equal(database.signingFailures(), 3);
  assert.equal(signingCalls, 3);
  assert.equal(database.transactionCalls(), 7);
});
