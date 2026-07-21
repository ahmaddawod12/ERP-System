import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import {
  READ_JOBS_ENTITLEMENT_SQL,
  READ_JOBS_PAGE_SQL,
  READ_JOB_ATTACHMENT_FILE_SQL,
  READ_JOB_DETAIL_SQL,
  decodeJobListCursor,
  encodeJobListCursor,
  readJobsPage,
} from "../jobs/read-repository.js";
import { registerJobsReadRoutes } from "../routes/jobs-read.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "3ff2c74a-b0bf-4c46-b759-dbdf23d93ab1";
const creatorUid = "5f5bd2f8-a62f-43de-8f4d-27c814607dac";
const internalCompanyId = "b879bd41-3211-4511-b5e9-323b0ff11ee7";
const webSessionToken = "R".repeat(43);
const firstJobId = "ffe77602-d9b1-4a53-97e1-52df99f97224";
const secondJobId = "4877089d-60c8-44f6-be79-116e6f3b34cc";
const thirdJobId = "126bf50f-51de-4cf7-a2a1-90fb615e12b5";
const attachmentId = "18188ccf-bb15-46ba-8825-c302b6e3d107";
const partId = "ab8224f8-8d29-49c2-949a-ae8cf92ab984";

function verifier(): SupabaseJwtVerifier {
  return {
    issuer: "https://project.supabase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      throw new Error("not used");
    },
    async verifyAccessToken() {
      return { userId, expiresAt: 4_102_444_800 };
    },
  };
}

function jobRow(
  jobId: string,
  jobNo: number,
  createdAt: string,
): Record<string, unknown> {
  return {
    job_id: jobId,
    job_no: jobNo,
    status: jobNo === 3 ? "waiting" : "pending",
    title: `Pump repair ${jobNo}`,
    description: "Replace the damaged relay",
    notes: null,
    location: "Haifa",
    address: null,
    category: "repair",
    priority: "high",
    due_at: null,
    client_id: "04bb6c8a-3f7b-4649-9b0f-e78c6b0173ab",
    client_name: "Northwind",
    client_phone: "+972501234567",
    assignee_member_no: 7,
    assignee_display_name: "Field worker",
    creator_uid: creatorUid,
    creator_member_no: 1,
    creator_display_name: "Manager",
    is_certificate: false,
    meta: {
      timeFrom: "08:00",
      timeTo: "09:30",
      signingPerson: "Dana",
      travelDistance: 12.5,
    },
    entity_version: "3",
    created_at: new Date(createdAt),
    cursor_created_at: createdAt,
    updated_at: new Date(createdAt),
    finished_at: null,
    denied_at: null,
  };
}

function database(): ApiDatabaseRuntime {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      const phase = queryIndex % 3;
      queryIndex += 1;
      if (phase === 0) {
        assert.equal(text, RESOLVE_TENANT_SQL);
        assert.deepEqual(values, [userId, 42]);
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: internalCompanyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: "manager",
            member_no: 1,
            tier: "Team",
            enabled_modules: {},
          }] as unknown as Row[],
        };
      }
      if (phase === 1) {
        assert.equal(text, READ_JOBS_ENTITLEMENT_SQL);
        assert.deepEqual(values, [internalCompanyId]);
        return {
          rowCount: 1,
          rows: [{ jobs_enabled: true }] as unknown as Row[],
        };
      }

      assert.equal(text, READ_JOBS_PAGE_SQL);
      assert.deepEqual(values, [
        internalCompanyId,
        ["pending", "waiting"],
        "2026-07-01T00:00:00.000Z",
        "2026-07-31T23:59:59.999Z",
        creatorUid,
        "pump",
        null,
        null,
        3,
        "createdAt",
        null,
        "pump",
      ]);
      return {
        rowCount: 3,
        rows: [
          jobRow(firstJobId, 3, "2026-07-13T12:00:00.000Z"),
          jobRow(secondJobId, 2, "2026-07-13T11:00:00.123456Z"),
          jobRow(thirdJobId, 1, "2026-07-13T10:00:00.000Z"),
        ] as unknown as Row[],
      };
    },
  };

  return {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, userId);
      return work(transaction);
    },
  };
}

test("jobs route applies bounded SQL filters and returns safe cursor DTOs", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerJobsReadRoutes(app, {
    database: database(),
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier(),
      webSessions: {
        async authenticateSession(token) {
          assert.equal(token, webSessionToken);
          return {
            userId,
            absoluteExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
          };
        },
      },
    }),
  });

  const url = "/api/v1/companies/42/jobs"
    + `?status=pending&status=waiting&creatorUid=${creatorUid}`
    + "&dateFrom=2026-07-01T00%3A00%3A00.000Z"
    + "&dateTo=2026-07-31T23%3A59%3A59.999Z&search=pump&pageSize=2";
  const response = await app.inject({
    method: "GET",
    url,
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[1].createdAt, "2026-07-13T11:00:00.123Z");
  assert.deepEqual(body.data.items[0], {
    jobId: firstJobId,
    jobNo: 3,
    status: "waiting",
    title: "Pump repair 3",
    description: "Replace the damaged relay",
    notes: null,
    location: "Haifa",
    address: null,
    category: "repair",
    priority: "high",
    dueAt: null,
    client: {
      id: "04bb6c8a-3f7b-4649-9b0f-e78c6b0173ab",
      name: "Northwind",
      phone: "+972501234567",
    },
    assignee: { memberNo: 7, displayName: "Field worker" },
    creator: { uid: creatorUid, memberNo: 1, displayName: "Manager" },
    isCertificate: false,
    timeFrom: "08:00",
    timeTo: "09:30",
    signingPerson: "Dana",
    travelDistance: 12.5,
    entityVersion: "ev1.Mw",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    finishedAt: null,
    deniedAt: null,
  });
  assert.equal(typeof body.data.nextCursor, "string");
  assert.equal(body.meta.nextCursor, body.data.nextCursor);
  assert.deepEqual(decodeJobListCursor(body.data.nextCursor), {
    createdAt: "2026-07-13T11:00:00.123456Z",
    id: secondJobId,
  });
  assert.doesNotMatch(body.data.nextCursor, /\|/);

  const webResponse = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `SmartJobSession ${webSessionToken}` },
  });
  assert.equal(webResponse.statusCode, 200, webResponse.body);
  assert.deepEqual(webResponse.json().data, body.data);
});

test("job cursors are canonical and malformed cursors fail closed", () => {
  const cursor = encodeJobListCursor("2026-07-13T12:00:00.123456Z", firstJobId);
  assert.deepEqual(decodeJobListCursor(cursor), {
    createdAt: "2026-07-13T12:00:00.123456Z",
    id: firstJobId,
  });
  assert.throws(
    () => decodeJobListCursor("not-a-canonical-cursor"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR"
    ),
  );
});

test("job reads default to 50 rows and fetch only one lookahead row", async () => {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, READ_JOBS_ENTITLEMENT_SQL);
        return {
          rowCount: 1,
          rows: [{ jobs_enabled: true }] as unknown as Row[],
        };
      }
      assert.equal(text, READ_JOBS_PAGE_SQL);
      assert.deepEqual(values, [
        internalCompanyId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        51,
        "createdAt",
        null,
        null,
      ]);
      return { rowCount: 0, rows: [] };
    },
  };

  assert.deepEqual(await readJobsPage(transaction, internalCompanyId, {}), {
    items: [],
    nextCursor: null,
  });
});

test("job read SQL enforces entitlement, role scope, filters, and composite keysets", () => {
  assert.match(READ_JOBS_ENTITLEMENT_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_JOBS_PAGE_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_JOBS_PAGE_SQL, /entitlement\.jobs_enabled/);
  assert.match(READ_JOBS_PAGE_SQL, /membership\.user_id = private\.app_auth_uid\(\)/);
  assert.match(READ_JOBS_PAGE_SQL, /requester\.role = 'worker'/);
  assert.match(READ_JOBS_PAGE_SQL, /requester\.role = 'user'[\s\S]*requester\.account_type = 'solo'/);
  assert.match(READ_JOBS_PAGE_SQL, /creator\.user_id = \$5::uuid::text/);
  assert.match(READ_JOBS_PAGE_SQL, /job\.status = ANY\(\$2::public\.job_status\[\]\)/);
  assert.match(READ_JOBS_PAGE_SQL, /WHEN 'finishedAt' THEN job\.finished_at/);
  assert.match(READ_JOBS_PAGE_SQL, /\(job\.created_at, job\.id\) < \(\$7::timestamptz, \$8::uuid\)/);
  assert.match(READ_JOBS_PAGE_SQL, /to_char\([\s\S]*job\.created_at AT TIME ZONE 'UTC'[\s\S]*\) AS cursor_created_at/);
  assert.match(READ_JOBS_PAGE_SQL, /ORDER BY job\.created_at DESC, job\.id DESC/);
  assert.match(READ_JOBS_PAGE_SQL, /LIMIT \$9::integer/);
  assert.match(READ_JOBS_PAGE_SQL, /job\.search_text LIKE/);
  assert.doesNotMatch(READ_JOBS_PAGE_SQL, /pg_catalog\.strpos/);
  assert.doesNotMatch(READ_JOBS_PAGE_SQL, /\bOFFSET\b|SELECT \*/i);
});

test("job detail returns parts and opaque attachment metadata, then signs an exact file", async (context) => {
  let objectPath = `${internalCompanyId}/${userId}/session/${attachmentId}.jpg`;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: internalCompanyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: "manager",
            member_no: 1,
            tier: "Team",
            enabled_modules: {},
          }] as unknown as Row[],
        };
      }
      if (text === READ_JOBS_ENTITLEMENT_SQL) {
        assert.deepEqual(values, [internalCompanyId]);
        return {
          rowCount: 1,
          rows: [{ jobs_enabled: true }] as unknown as Row[],
        };
      }
      if (text === READ_JOB_DETAIL_SQL) {
        assert.deepEqual(values, [internalCompanyId, firstJobId]);
        return {
          rowCount: 1,
          rows: [{
            ...jobRow(firstJobId, 3, "2026-07-13T12:00:00.000Z"),
            parts: [{ partId, partNo: 42, name: "Relay", quantity: 2 }],
            attachments: [{
              attachmentId,
              kind: "photo",
              fileName: "before.jpg",
              mimeType: "image/jpeg",
              sizeBytes: 1_024,
              sha256: "a".repeat(64),
              createdAt: "2026-07-13T12:00:00.000Z",
            }],
          }] as unknown as Row[],
        };
      }
      if (text === READ_JOB_ATTACHMENT_FILE_SQL) {
        assert.deepEqual(values, [internalCompanyId, firstJobId, attachmentId]);
        return {
          rowCount: 1,
          rows: [{
            job_id: firstJobId,
            attachment_id: attachmentId,
            kind: "photo",
            storage_path: objectPath,
          }] as unknown as Row[],
        };
      }
      throw new Error("Unexpected query");
    },
  };
  const runtime: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(_context, work) {
      return work(transaction);
    },
  };
  const signedPaths: string[] = [];
  const storage: CompanyFileStorage = {
    async createSignedUploadTargets() { return []; },
    async verifyUploadedAttachments() {},
    async createSignedDownloadUrl(path, expiresInSeconds) {
      signedPaths.push(path);
      assert.equal(expiresInSeconds, 900);
      return "https://storage.example/signed-job-photo?token=private";
    },
    async removeObjects() {},
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerJobsReadRoutes(app, {
    database: runtime,
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier(),
      webSessions: { async authenticateSession() { throw new Error("not used"); } },
    }),
    storage,
  });

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/jobs/${firstJobId}`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(detailResponse.statusCode, 200, detailResponse.body);
  assert.equal(detailResponse.headers["cache-control"], "private, no-store");
  const detail = detailResponse.json().data;
  assert.equal(detail.parts[0].partNo, 42);
  assert.equal(detail.attachments[0].fileName, "before.jpg");
  assert.equal("storagePath" in detail.attachments[0], false);

  const downloadResponse = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/jobs/${firstJobId}/attachments/${attachmentId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(downloadResponse.statusCode, 200, downloadResponse.body);
  assert.equal(downloadResponse.headers["cache-control"], "private, no-store");
  assert.equal(downloadResponse.json().data.downloadURL, "https://storage.example/signed-job-photo?token=private");
  assert.deepEqual(signedPaths, [objectPath]);

  objectPath = `${internalCompanyId}/../foreign/${attachmentId}.jpg`;
  const invalidPathResponse = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/jobs/${firstJobId}/attachments/${attachmentId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(invalidPathResponse.statusCode, 409, invalidPathResponse.body);
  assert.equal(invalidPathResponse.json().error.code, "JOB_ATTACHMENT_FILE_INVALID");
  assert.equal(signedPaths.length, 1);
});

test("job detail and attachment SQL preserve the list role scope", () => {
  for (const sql of [READ_JOB_DETAIL_SQL, READ_JOB_ATTACHMENT_FILE_SQL]) {
    assert.match(sql, /membership\.user_id = private\.app_auth_uid\(\)/);
    assert.match(sql, /requester\.role = 'worker'/);
    assert.match(sql, /requester\.role = 'user'[\s\S]*requester\.account_type = 'solo'/);
    assert.match(sql, /job\.assigned_membership_id = requester\.membership_id/);
    assert.doesNotMatch(sql, /SELECT \*/i);
  }
});
