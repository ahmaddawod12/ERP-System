import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable, DatabaseQueryResult } from "../database/runtime.js";
import {
  CREATE_DOCUMENT_GENERATION_TASK_SQL,
  CREATE_DOCUMENT_PREVIEW_TASK_SQL,
  DELETE_DOCUMENT_SQL,
} from "../documents/mutation-repository.js";
import { encodeEntityVersion } from "../entities/version.js";
import { registerDocumentMutationRoutes } from "../routes/documents-mutations.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const internalCompanyId = "26963503-982a-4552-97d0-45b5fdbfbda9";
const documentId = "9b4f0638-e356-4f78-8981-e94a5c9a484c";
const previewTaskId = "07f318c2-757d-4e9b-94db-ebeb9f7502dd";
const generateTaskId = "07d50ca9-c8c8-4092-ac6e-a1192510dacb";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

const documentData = {
  client: { name: "Northwind Cooling", email: "dispatch@northwind.example", city: "Haifa" },
  items: [{ description: "Field service", quantity: 2, price: 50 }],
  language: "he" as const,
  date: "2026-07-13",
  notes: "Service visit",
};

test("document mutations use verified, idempotent, narrow SQL transactions", async (context) => {
  const claims = new Map<string, {
    requestHash: Buffer;
    responseStatus: number | null;
    responseBody: unknown;
    completedAt: Date | null;
  }>();
  const calls = { preview: 0, generate: 0, remove: 0 };
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Document Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { documents: true },
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        const operation = String(values?.[2]);
        if (!claims.has(operation)) {
          claims.set(operation, {
            requestHash: values?.[4] as Buffer,
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
      if (text.includes("UPDATE private.api_idempotency")) {
        const operation = String(values?.[0]).replace(/^claim-/u, "");
        const claim = claims.get(operation);
        assert.ok(claim);
        claim.responseStatus = Number(values?.[1]);
        claim.responseBody = JSON.parse(String(values?.[2]));
        claim.completedAt = new Date();
        return { rowCount: 1, rows: [] as Row[] };
      }
      if (text === CREATE_DOCUMENT_PREVIEW_TASK_SQL) {
        calls.preview += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], 200);
        assert.deepEqual(JSON.parse(String(values?.[2])), documentData);
        return result<Row>([{
          task_key: previewTaskId,
          task_status: "pending",
          document_id: null,
          document_code: null,
          entity_version: null,
          dispatch_payload: { taskId: previewTaskId },
        }]);
      }
      if (text === CREATE_DOCUMENT_GENERATION_TASK_SQL) {
        calls.generate += 1;
        assert.equal(values?.[0], internalCompanyId);
        assert.equal(values?.[1], 200);
        return result<Row>([{
          task_key: generateTaskId,
          task_status: "pending",
          document_id: documentId,
          document_code: "DN1-77",
          entity_version: "1",
          dispatch_payload: { taskId: generateTaskId },
        }]);
      }
      if (text === DELETE_DOCUMENT_SQL) {
        calls.remove += 1;
        assert.deepEqual(values, [internalCompanyId, documentId, "1"]);
        return result<Row>([{ document_id: documentId, document_code: "DN1-77" }]);
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 100)}`);
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
  const authenticator: ApiRequestAuthenticator = {
    async authenticate() {
      return { scheme: "bearer", userId, expiresAt: 4_102_444_800, accessToken: "token.payload.signature" };
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerDocumentMutationRoutes(app, {
    authenticator,
    database,
    supabaseUsers: {
      async getUser() {
        return { userId, email: "manager@example.test", emailVerified: true };
      },
    },
  });

  const previewRequest = {
    method: "POST" as const,
    url: "/api/v1/companies/77/document-tasks/preview",
    headers: { "idempotency-key": "document-preview-key-123" },
    payload: { documentType: 200, documentData },
  };
  const preview = await app.inject(previewRequest);
  assert.equal(preview.statusCode, 202, preview.body);
  assert.equal(preview.json().data.taskId, previewTaskId);
  const previewReplay = await app.inject(previewRequest);
  assert.equal(previewReplay.statusCode, 202, previewReplay.body);
  assert.equal(calls.preview, 1);

  const generateRequest = {
    method: "POST" as const,
    url: "/api/v1/companies/77/document-tasks/generate",
    headers: { "idempotency-key": "document-generate-key-123" },
    payload: { documentType: 200, documentData },
  };
  const generated = await app.inject(generateRequest);
  assert.equal(generated.statusCode, 202, generated.body);
  assert.deepEqual(generated.json().data, {
    taskId: generateTaskId,
    status: "pending",
    documentId,
    documentCode: "DN1-77",
    entityVersion: encodeEntityVersion(1),
  });
  const generateReplay = await app.inject(generateRequest);
  assert.equal(generateReplay.statusCode, 202, generateReplay.body);
  assert.equal(calls.generate, 1);

  const tax = await app.inject({
    ...generateRequest,
    headers: { "idempotency-key": "document-tax-key-123456" },
    payload: { documentType: 305, documentData },
  });
  assert.equal(tax.statusCode, 400, tax.body);

  const removalRequest = {
    method: "DELETE" as const,
    url: `/api/v1/companies/77/documents/${documentId}`,
    headers: { "idempotency-key": "document-delete-key-1234" },
    payload: { entityVersion: encodeEntityVersion(1) },
  };
  const removed = await app.inject(removalRequest);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(removed.json().data, {
    documentId,
    documentCode: "DN1-77",
    disposition: "deleted",
  });
  const removalReplay = await app.inject(removalRequest);
  assert.equal(removalReplay.statusCode, 200, removalReplay.body);
  assert.deepEqual(calls, { preview: 1, generate: 1, remove: 1 });
});

test("document migration owns totals, counters, versions, and dispatch leases", () => {
  const migration = readFileSync(
    new URL("../../../packages/db/migrations/0022_api_document_tasks.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /documents_increment_entity_version/);
  assert.match(migration, /private\.allocate_company_counter\(p_company_id, 'doc_' \|\| p_document_type::TEXT\)/);
  assert.match(migration, /v_vat_amount := pg_catalog\.round\(v_total_before_vat \* 0\.18, 2\)/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /dispatch_lease_token/);
  assert.match(migration, /APPROVED_TAX_DOCUMENT_IMMUTABLE/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.create_api_document_generation_task[\s\S]*TO smart_job_api/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE) ON public\.(?:documents|document_tasks) TO smart_job_api/i);
});
