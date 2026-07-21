import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import type { ArchiveStorage } from "../archives/archive-storage.js";
import {
  READ_ARCHIVE_DOWNLOAD_SQL,
  readArchivesPage,
} from "../archives/read-repository.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import { registerArchiveReadRoutes } from "../routes/archives-read.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const companyId = "13f75f93-f96a-4873-b889-a7aeab06c333";
const firstId = "3b5cc006-75cb-45cb-b13d-6db90b568e14";
const secondId = "52c18673-0090-4628-8960-524047673d8c";
const thirdId = "5cb6b24c-d028-480b-a7a2-5f50a8013ab6";

function archiveRow(id: string, archiveKey: string, createdAt: string) {
  return {
    id,
    archive_key: archiveKey,
    data_type: "jobs",
    status: "deleted",
    doc_count: 5,
    deleted_count: 5,
    storage_path: `companies/42/archives/${archiveKey}.json`,
    checksum: "a".repeat(64),
    created_at: new Date(createdAt),
    completed_at: new Date(createdAt),
  };
}

test("archive rows normalize pg dates and paginate with the archive UUID", async () => {
  const calls: unknown[][] = [];
  let page = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(_text: string, values?: readonly unknown[]) {
      calls.push([...(values ?? [])]);
      page += 1;
      return {
        rowCount: page === 1 ? 3 : 0,
        rows: (page === 1
          ? [
              archiveRow(firstId, "2026-06-j", "2026-07-03T12:00:00.000Z"),
              archiveRow(secondId, "2026-05-j", "2026-07-02T12:00:00.000Z"),
              archiveRow(thirdId, "2026-04-j", "2026-07-01T12:00:00.000Z"),
            ]
          : []) as unknown as Row[],
      };
    },
  };

  const first = await readArchivesPage(transaction, {
    internalCompanyId: companyId,
    pageSize: 2,
  });
  assert.equal(first.items[0]?.archiveRunId, firstId);
  assert.equal("storagePath" in first.items[0]!, false);
  assert.equal(first.items[0]?.createdAt, "2026-07-03T12:00:00.000Z");
  assert.equal(first.items[1]?.completedAt, "2026-07-02T12:00:00.000Z");
  assert.ok(first.nextCursor);

  await readArchivesPage(transaction, {
    internalCompanyId: companyId,
    pageSize: 2,
    cursor: first.nextCursor,
  });
  assert.equal(calls[1]?.[3], "2026-07-02T12:00:00.000Z");
  assert.equal(calls[1]?.[4], secondId);
});

test("archive cursors reject malformed JSON instead of leaking a SyntaxError", async () => {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>() {
      return { rowCount: 0, rows: [] as Row[] };
    },
  };
  const malformed = Buffer.from("not-json", "utf8").toString("base64url");
  await assert.rejects(
    readArchivesPage(transaction, { internalCompanyId: companyId, cursor: malformed }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR",
  );
});

test("exact archive downloads use the recorded path and filter worker rows server-side", async (context) => {
  const workerId = "8a52fffd-b4c0-484c-b952-f7c75fd84c63";
  const documentRunId = "2db0480e-1161-4cf1-98fe-89f21346991d";
  const objectPath = "companies/42/archives/2026-6-j.json";
  let enabledModules: Record<string, boolean> = {};
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        return {
          rowCount: 1,
          rows: [{
            internal_company_id: companyId,
            public_company_id: "42",
            name: "Field Services",
            account_type: "business",
            role: "worker",
            member_no: 7,
            tier: "Team",
            enabled_modules: enabledModules,
          }] as unknown as Row[],
        };
      }
      if (text === READ_ARCHIVE_DOWNLOAD_SQL) {
        const runId = String(values?.[1]);
        return {
          rowCount: 1,
          rows: [{
            id: runId,
            archive_key: runId === documentRunId ? "2026-6-d" : "2026-6-j",
            data_type: runId === documentRunId ? "documents" : "jobs",
            status: "deleted",
            storage_path: runId === documentRunId
              ? "companies/42/archives/2026-6-d.json"
              : objectPath,
            checksum: "a".repeat(64),
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
    async withTransaction(_request, work) { return work(transaction); },
  };
  const verifier: SupabaseJwtVerifier = {
    issuer: "https://project.supabase.co/auth/v1",
    audiences: ["authenticated"],
    async verifyAuthorizationHeader() {
      return { userId: workerId, expiresAt: 4_102_444_800 };
    },
    async verifyAccessToken() {
      return { userId: workerId, expiresAt: 4_102_444_800 };
    },
  };
  const readPaths: string[] = [];
  const archiveStorage: ArchiveStorage = {
    async readArchiveJson() { return null; },
    async readArchiveJsonByPath(companyStorageId, path) {
      assert.equal(companyStorageId, "42");
      readPaths.push(path);
      return { items: [{ id: 1, wid: "7" }, { id: 2, wid: "8" }] };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerArchiveReadRoutes(app, {
    database: runtime,
    authenticator: createApiRequestAuthenticator({
      jwtVerifier: verifier,
      webSessions: { async authenticateSession() { throw new Error("not used"); } },
    }),
    archiveStorage,
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/archives/${firstId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().data.items, [{ id: 1, wid: "7" }]);
  assert.deepEqual(readPaths, [objectPath]);

  const forbidden = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/archives/${documentRunId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  assert.equal(forbidden.json().error.code, "ARCHIVE_ACCESS_FORBIDDEN");
  assert.deepEqual(readPaths, [objectPath]);

  enabledModules = { solojob: false };
  const disabled = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/archives/${firstId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(disabled.statusCode, 403, disabled.body);
  assert.equal(disabled.json().error.code, "ARCHIVE_MODULE_DISABLED");
  assert.deepEqual(readPaths, [objectPath]);
});
