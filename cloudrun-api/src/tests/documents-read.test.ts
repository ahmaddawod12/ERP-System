import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import {
  READ_DOCUMENT_ACCESS_SQL,
  READ_DOCUMENT_DETAIL_SQL,
  READ_DOCUMENT_FILE_SQL,
  READ_DOCUMENT_PAGE_SQL,
  READ_DOCUMENT_TASK_SQL,
  decodeDocumentListCursor,
  encodeDocumentListCursor,
  readDocumentsPage,
} from "../documents/read-repository.js";
import { registerDocumentsReadRoutes } from "../routes/documents-read.js";
import type { CompanyFileStorage } from "../storage/company-files.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "ccf64399-765f-43f1-a0f7-0b3330d879b0";
const internalCompanyId = "0e3a7ba3-7667-47bd-806a-cb4eb08bd2f7";
const documentId = "b864bf5e-8df9-4d68-91a9-35928207a4c6";
const secondDocumentId = "17d76e0f-69cc-40da-966c-9c16728fc359";
const thirdDocumentId = "c1a7987d-226d-4d52-b8f0-4c866d3c2545";
const taskId = `generate:${internalCompanyId}:200:${userId}:1783944000000`;

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

function tenantRow(role = "manager") {
  return {
    internal_company_id: internalCompanyId,
    public_company_id: "42",
    name: "Field Services",
    account_type: "business",
    role,
    member_no: 1,
    tier: "Team",
    enabled_modules: { documents: true },
  };
}

function documentRow(id: string, number: number, createdAt: string) {
  return {
    document_id: id,
    document_code: `${number}-DN`,
    document_type: 200,
    document_number: number,
    generation_status: "completed",
    tax_authority_status: "none",
    client_id: "e46d7579-7d26-48f7-b89d-778cd054502d",
    client_name: "Northwind",
    client_phone: "+972501234567",
    client_city: "Haifa",
    client_vat_number: "123456789",
    creator_uid: userId,
    creator_member_no: 1,
    creator_display_name: "Manager",
    language: "he",
    notes: null,
    total_before_vat: "100.00",
    vat_amount: "18.00",
    total_with_vat: "118.00",
    confirmation_number: null,
    document_date: new Date(createdAt),
    storage_path: `${internalCompanyId}/documents/${id}.pdf`,
    email_sent: false,
    email_delivery_status: null,
    entity_version: "1",
    created_at: new Date(createdAt),
    cursor_created_at: createdAt,
    updated_at: new Date(createdAt),
  };
}

function database(
  query: (text: string, values: readonly unknown[] | undefined) => Promise<{
    rowCount: number;
    rows: unknown[];
  }>,
): ApiDatabaseRuntime {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      const result = await query(text, values);
      return { rowCount: result.rowCount, rows: result.rows as Row[] };
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

function authenticator() {
  return createApiRequestAuthenticator({
    jwtVerifier: verifier(),
    webSessions: { async authenticateSession() { throw new Error("not used"); } },
  });
}

function storage(signedCalls: Array<{ path: string; ttl: number }>): CompanyFileStorage {
  return {
    async createSignedUploadTargets() { throw new Error("not used"); },
    async verifyUploadedAttachments() { throw new Error("not used"); },
    async removeObjects() { throw new Error("not used"); },
    async createSignedDownloadUrl(path, ttl) {
      signedCalls.push({ path, ttl });
      return `https://project.supabase.co/storage/v1/object/sign/smart-job-company-files/${path}?token=signed`;
    },
  };
}

test("documents route applies SQL filters and preserves exact composite cursors", async (context) => {
  let queryIndex = 0;
  const runtime = database(async (text, values) => {
    queryIndex += 1;
    if (queryIndex === 1) {
      assert.equal(text, RESOLVE_TENANT_SQL);
      assert.deepEqual(values, [userId, 42]);
      return { rowCount: 1, rows: [tenantRow()] };
    }
    if (queryIndex === 2) {
      assert.equal(text, READ_DOCUMENT_ACCESS_SQL);
      return { rowCount: 1, rows: [{ role: "manager", is_dev: false, documents_enabled: true }] };
    }
    assert.equal(text, READ_DOCUMENT_PAGE_SQL);
    assert.deepEqual(values, [
      internalCompanyId,
      "northwind",
      null,
      ["completed"],
      [200],
      userId,
      "2026-07-01T00:00:00.000Z",
      "2026-07-31T23:59:59.999Z",
      null,
      null,
      3,
    ]);
    return {
      rowCount: 3,
      rows: [
        documentRow(documentId, 3, "2026-07-13T12:00:00.000Z"),
        documentRow(secondDocumentId, 2, "2026-07-13T11:00:00.123456Z"),
        documentRow(thirdDocumentId, 1, "2026-07-13T10:00:00.000Z"),
      ],
    };
  });
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerDocumentsReadRoutes(app, { database: runtime, authenticator: authenticator() });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/companies/42/documents?search=northwind&status=completed"
      + `&documentType=200&createdByUid=${userId}&pageSize=2`
      + "&dateFrom=2026-07-01T00%3A00%3A00.000Z&dateTo=2026-07-31T23%3A59%3A59.999Z",
    headers: { authorization: "Bearer header.payload.signature" },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.json();
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0].documentCode, "3-DN");
  assert.equal(body.data.items[0].hasFile, true);
  assert.equal(body.data.items[0].totalWithVat, 118);
  assert.equal(body.data.items[1].createdAt, "2026-07-13T11:00:00.123Z");
  assert.deepEqual(decodeDocumentListCursor(body.data.nextCursor), {
    createdAt: "2026-07-13T11:00:00.123456Z",
    id: secondDocumentId,
  });
  assert.equal(body.meta.nextCursor, body.data.nextCursor);
});

test("document file and completed task routes create fresh scoped signed URLs", async (context) => {
  const signedCalls: Array<{ path: string; ttl: number }> = [];
  const runtime = database(async (text, values) => {
    if (text === RESOLVE_TENANT_SQL) {
      assert.deepEqual(values, [userId, 42]);
      return { rowCount: 1, rows: [tenantRow()] };
    }
    if (text === READ_DOCUMENT_ACCESS_SQL) {
      return { rowCount: 1, rows: [{ role: "manager", is_dev: false, documents_enabled: true }] };
    }
    if (text === READ_DOCUMENT_FILE_SQL) {
      assert.deepEqual(values, [internalCompanyId, documentId]);
      return {
        rowCount: 1,
        rows: [{
          document_id: documentId,
          document_code: "3-DN",
          storage_path: `${internalCompanyId}/documents/${documentId}.pdf`,
        }],
      };
    }
    assert.equal(text, READ_DOCUMENT_TASK_SQL);
    assert.deepEqual(values, [internalCompanyId, taskId]);
    return {
      rowCount: 1,
      rows: [{
        task_key: taskId,
        task_type: "generate",
        status: "completed",
        user_id: userId,
        document_code: "3-DN",
        request_payload: {},
        preview_url: null,
        generate_url: "https://expired.example/file.pdf",
        storage_path: `${internalCompanyId}/documents/${documentId}.pdf`,
        pdf_size: 2048,
        error: null,
        processing_started_at: new Date("2026-07-13T12:01:00.000Z"),
        completed_at: new Date("2026-07-13T12:02:00.000Z"),
        created_at: new Date("2026-07-13T12:00:00.000Z"),
      }],
    };
  });
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerDocumentsReadRoutes(app, {
    database: runtime,
    authenticator: authenticator(),
    storage: storage(signedCalls),
  });

  const download = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/documents/${documentId}/download`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.json().data.documentCode, "3-DN");
  assert.match(download.json().data.downloadURL, /token=signed$/);

  const task = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/document-tasks/${encodeURIComponent(taskId)}`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(task.statusCode, 200, task.body);
  assert.equal(task.json().data.downloadURL.includes("expired.example"), false);
  assert.match(task.json().data.downloadURL, /token=signed$/);
  assert.deepEqual(signedCalls, [
    { path: `${internalCompanyId}/documents/${documentId}.pdf`, ttl: 900 },
    { path: `${internalCompanyId}/documents/${documentId}.pdf`, ttl: 300 },
  ]);
});

test("document detail returns authoritative tax and email workflow state", async (context) => {
  const runtime = database(async (text, values) => {
    if (text === RESOLVE_TENANT_SQL) {
      assert.deepEqual(values, [userId, 42]);
      return { rowCount: 1, rows: [tenantRow()] };
    }
    if (text === READ_DOCUMENT_ACCESS_SQL) {
      return { rowCount: 1, rows: [{ role: "manager", is_dev: false, documents_enabled: true }] };
    }
    assert.equal(text, READ_DOCUMENT_DETAIL_SQL);
    assert.deepEqual(values, [internalCompanyId, documentId]);
    return {
      rowCount: 1,
      rows: [{
        ...documentRow(documentId, 1, "2026-07-18T12:00:00.000Z"),
        document_code: "TI-77-1",
        document_type: 305,
        tax_authority_status: "submitted",
        generation_status: "pending",
        storage_path: null,
        payload: {},
        email_delivery_status: "queued",
        tax_submission_status: "submitted",
      }],
    };
  });
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerDocumentsReadRoutes(app, { database: runtime, authenticator: authenticator() });

  const response = await app.inject({
    method: "GET",
    url: `/api/v1/companies/42/documents/${documentId}`,
    headers: { authorization: "Bearer header.payload.signature" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.taxAuthorityStatus, "submitted");
  assert.equal(response.json().data.taxSubmissionStatus, "submitted");
  assert.equal(response.json().data.emailDeliveryStatus, "queued");
  assert.equal(response.json().data.hasFile, false);
  assert.equal(response.json().data.paymentMethod, null);
  assert.equal(response.json().data.paymentDetails, null);
});

test("document cursors are canonical and malformed values fail closed", () => {
  const cursor = encodeDocumentListCursor("2026-07-13T12:00:00.123456Z", documentId);
  assert.deepEqual(decodeDocumentListCursor(cursor), {
    createdAt: "2026-07-13T12:00:00.123456Z",
    id: documentId,
  });
  assert.throws(
    () => decodeDocumentListCursor("not-a-canonical-cursor"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_CURSOR",
  );
});

test("document reads default to 50 rows and SQL enforces access, filters, and tax approval", async () => {
  let queryIndex = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queryIndex += 1;
      if (queryIndex === 1) {
        assert.equal(text, READ_DOCUMENT_ACCESS_SQL);
        return {
          rowCount: 1,
          rows: [{ role: "basic", is_dev: false, documents_enabled: true }] as unknown as Row[],
        };
      }
      assert.equal(text, READ_DOCUMENT_PAGE_SQL);
      assert.deepEqual(values, [internalCompanyId, null, null, null, null, null, null, null, null, null, 51]);
      return { rowCount: 0, rows: [] };
    },
  };
  assert.deepEqual(await readDocumentsPage(transaction, internalCompanyId, {}), {
    items: [],
    nextCursor: null,
  });

  assert.match(READ_DOCUMENT_ACCESS_SQL, /private\.get_company_module_entitlements/);
  assert.match(READ_DOCUMENT_ACCESS_SQL, /membership\.user_id = private\.app_auth_uid\(\)/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /document\.company_id = \$1::uuid/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /document\.document_type <> 305 OR document\.tax_authority_status = 'approved'/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /document\.generation_status = ANY\(\$4::public\.document_generation_status\[\]\)/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /document\.document_type = ANY\(\$5::smallint\[\]\)/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /creator\.user_id = \$6::text/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /\(document\.created_at, document\.id\) < \(\$9::timestamptz, \$10::uuid\)/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /ORDER BY document\.created_at DESC, document\.id DESC/);
  assert.match(READ_DOCUMENT_PAGE_SQL, /LIMIT \$11::integer/);
  assert.doesNotMatch(READ_DOCUMENT_PAGE_SQL, /\bOFFSET\b|SELECT \*/i);
});
