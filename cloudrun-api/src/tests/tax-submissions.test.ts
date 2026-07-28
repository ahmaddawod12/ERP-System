import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import {
  TaxGatewayAmbiguousError,
  TaxGatewayPreSendError,
  createTaxGatewayClient,
} from "../tax/gateway-client.js";
import { registerInternalTaxSubmissionRoutes } from "../routes/internal-tax-submissions.js";
import { registerTaxInvoiceRoutes } from "../routes/tax-invoices.js";
import { RESOLVE_TENANT_SQL } from "../tenancy/context.js";

const userId = "1b9b2fa8-8d35-4db7-b5cf-fd1a94de7ce8";
const internalCompanyId = "d3a3bb5a-22f5-4e78-95da-07922ca7b0fa";
const documentId = "8a10de29-720d-46a2-96ca-56371a4f51a1";
const submissionIds = [
  "83ee5752-37dd-4f52-831b-c8025315ba0e",
  "b6daa866-6f63-43b1-9224-f6a9feb89dee",
  "16eb7826-901e-44ca-b59d-47892a60ef87",
] as const;

const invoice = {
  client: { name: "Northwind Cooling", email: "billing@northwind.example" },
  items: [{ description: "Field service", quantity: 1, price: 100 }],
  language: "he" as const,
  date: "2026-07-18",
};

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

function authenticator(): ApiRequestAuthenticator {
  return {
    async authenticate() {
      return {
        scheme: "bearer",
        userId,
        expiresAt: 4_102_444_800,
        accessToken: "header.payload.signature",
      };
    },
  };
}

function verifiedUsers() {
  return {
    async getUser() {
      return { userId, email: "manager@example.test", emailVerified: true };
    },
  };
}

test("tax creation fails closed while disabled without allocating a document", async (context) => {
  let transactions = 0;
  const database: ApiDatabaseRuntime = {
    maxConnections: 1,
    async checkReadiness() {},
    async close() {},
    async withTransaction() {
      transactions += 1;
      throw new Error("disabled tax creation must not open a transaction");
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerTaxInvoiceRoutes(app, {
    database,
    authenticator: authenticator(),
    firebaseUsers: verifiedUsers(),
    taxSubmissionMode: "disabled",
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies/77/tax-invoices",
    headers: { "idempotency-key": "tax-create-disabled-123" },
    payload: invoice,
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().error.code, "TAX_SUBMISSION_DISABLED");
  assert.equal(transactions, 0);
});

test("tax creation is strict, server-typed, and idempotently queues one reservation", async (context) => {
  let requestHash: Buffer | undefined;
  let responseBody: unknown = null;
  let completedAt: Date | null = null;
  let creates = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === RESOLVE_TENANT_SQL) {
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "77",
          name: "Tax Workspace",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: { documents: true },
        }]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        requestHash ??= values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        return result<Row>([{
          id: "tax-claim-1",
          request_hash: requestHash,
          response_status: completedAt === null ? null : 202,
          response_body: responseBody,
          completed_at: completedAt,
          expires_at: new Date(Date.now() + 60_000),
        }]);
      }
      if (text.includes("private.create_api_tax_invoice")) {
        creates += 1;
        assert.deepEqual(values?.slice(0, 2), [internalCompanyId, invoice]);
        assert.ok(values?.[2] instanceof Date);
        return result<Row>([{
          document_id: documentId,
          document_code: "TI-77-1",
          document_number: 1,
          tax_authority_status: "reserved",
          tax_submission_status: "queued",
          correlation_id: "tax-correlation-77-0001",
          entity_version: "1",
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        responseBody = JSON.parse(String(values?.[2]));
        completedAt = new Date();
        return { rowCount: 1, rows: [] as Row[] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 1,
    async checkReadiness() {},
    async close() {},
    async withTransaction(transactionContext, work) {
      assert.equal(transactionContext.userId, userId);
      return work(transaction);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerTaxInvoiceRoutes(app, {
    database,
    authenticator: authenticator(),
    firebaseUsers: verifiedUsers(),
    taxSubmissionMode: "sandbox",
    taxGatewayClient: { async requestApproval() { throw new Error("drain-only dependency"); } },
  });

  const request = {
    method: "POST" as const,
    url: "/api/v1/companies/77/tax-invoices",
    headers: { "idempotency-key": "tax-create-idempotent-123" },
    payload: invoice,
  };
  const accepted = await app.inject(request);
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.deepEqual(accepted.json().data, {
    documentId,
    documentCode: "TI-77-1",
    documentNumber: 1,
    taxAuthorityStatus: "reserved",
    submissionStatus: "queued",
  });
  const replay = await app.inject(request);
  assert.equal(replay.statusCode, 202, replay.body);
  assert.deepEqual(replay.json().data, accepted.json().data);
  assert.equal(creates, 1);

  const forgedType = await app.inject({
    ...request,
    headers: { "idempotency-key": "tax-forged-type-12345" },
    payload: { ...invoice, documentType: 305 },
  });
  assert.equal(forgedType.statusCode, 400, forgedType.body);
  assert.equal(creates, 1);
});

test("tax drain retries only pre-send failures and quarantines ambiguous submissions", async (context) => {
  const outcomes: string[] = [];
  let claimLease = "";
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text.includes("private.claim_api_tax_submission_batch")) {
        claimLease = String(values?.[0]);
        assert.match(claimLease, /^[0-9a-f-]{36}$/iu);
        assert.deepEqual(values?.slice(1), [3, 60, null]);
        return result<Row>(submissionIds.map((submissionId, index) => ({
          submission_id: submissionId,
          internal_company_id: internalCompanyId,
          internal_document_id: documentId,
          correlation_id: ["approved-correlation", "pre-send-correlation", "ambiguous-correlation"][index],
          request_payload: { invoice },
          submission_attempt: 1,
        })));
      }
      if (text.includes("private.process_api_tax_submission_result")) {
        assert.equal(values?.[0], "approved-correlation");
        assert.equal(values?.[3], "approved");
        outcomes.push("processed");
        return result<Row>([{ processed: true, idempotent_replay: false }]);
      }
      if (text.includes("private.retry_api_tax_submission")) {
        assert.equal(values?.[0], submissionIds[1]);
        assert.equal(values?.[1], claimLease);
        outcomes.push("deferred");
        return result<Row>([{ retried: true }]);
      }
      if (text.includes("private.mark_api_tax_submission_unknown")) {
        assert.equal(values?.[0], submissionIds[2]);
        assert.equal(values?.[1], claimLease);
        outcomes.push("unknown");
        return result<Row>([{ marked: true }]);
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 1,
    async checkReadiness() {},
    async close() {},
    async withTransaction(transactionContext, work) {
      assert.equal(transactionContext.userId, userId);
      return work(transaction);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInternalTaxSubmissionRoutes(app, {
    database,
    taxSubmissionMode: "sandbox",
    internalIdentityVerifier: {
      async verifyAuthorizationHeader(header) {
        assert.equal(header, "Bearer scheduler-token");
        return {
          subject: "123456789012345678901",
          email: "scheduler@example.iam.gserviceaccount.com",
          contextUserId: userId,
        };
      },
    },
    taxGatewayClient: {
      async requestApproval(input) {
        if (input.correlationId === "approved-correlation") {
          return { status: "approved", confirmationNumber: "CONFIRM-77" };
        }
        if (input.correlationId === "pre-send-correlation") {
          throw new TaxGatewayPreSendError("identity token unavailable");
        }
        throw new TaxGatewayAmbiguousError("timeout after request write");
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax-submissions/drain",
    headers: { authorization: "Bearer scheduler-token" },
    payload: { limit: 3 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().data, {
    claimed: 3,
    processed: 1,
    deferred: 1,
    submissionUnknown: 1,
  });
  assert.deepEqual(outcomes, ["processed", "deferred", "unknown"]);
});

test("tax gateway distinguishes pre-send identity failure from ambiguous outbound failure", async () => {
  const config = {
    url: new URL("https://tax.example.test/api/v1/tax/approval"),
    audience: "https://tax.example.test",
    timeoutMs: 1_000,
  };
  const preSend = createTaxGatewayClient(config, {
    getIdentityToken: async () => { throw new Error("metadata unavailable"); },
  });
  await assert.rejects(
    preSend.requestApproval({ documentId, correlationId: "correlation-1", invoice }),
    TaxGatewayPreSendError,
  );

  const ambiguous = createTaxGatewayClient(config, {
    getIdentityToken: async () => "header.payload.signature",
    fetchImplementation: async () => { throw new Error("socket timeout"); },
  });
  await assert.rejects(
    ambiguous.requestApproval({ documentId, correlationId: "correlation-2", invoice }),
    TaxGatewayAmbiguousError,
  );

  let outboundBody: unknown;
  const accepted = createTaxGatewayClient(config, {
    getIdentityToken: async () => "header.payload.signature",
    fetchImplementation: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer header.payload.signature");
      outboundBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        ok: true,
        data: { status: "pending", authorityRequestId: "authority-77" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(
    await accepted.requestApproval({ documentId, correlationId: "correlation-3", invoice }),
    { status: "submitted", authorityRequestId: "authority-77" },
  );
  assert.deepEqual(outboundBody, {
    oauthSessionId: "correlation-3",
    documentId,
    invoice,
  });
});
