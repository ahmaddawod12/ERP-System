import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiDatabaseRuntime, DatabaseQueryable, DatabaseQueryResult } from "../database/runtime.js";
import type { GoogleServiceIdentityVerifier } from "../auth/google-service-identity.js";
import { registerInternalTaxCallbackRoute } from "../routes/internal-tax-callback.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { AppError } from "../http/errors.js";

const contextUserId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";

const validRequestBody = {
  eventId: "event-1234-abcd",
  payloadHash: "a".repeat(64),
  callback: {
    oauthSessionId: "session-abc-123",
    status: "approved" as const,
    confirmationNumber: "CONF-2026-0001",
  },
};

function makeDatabase(
  queryImpl: (text: string, values?: readonly unknown[]) => DatabaseQueryResult<QueryResultRow>,
): ApiDatabaseRuntime {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      return queryImpl(text, values) as DatabaseQueryResult<Row>;
    },
  };
  return {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, contextUserId);
      return work(transaction);
    },
  };
}

function makeIdentityVerifier(): GoogleServiceIdentityVerifier {
  return {
    async verifyAuthorizationHeader(header) {
      if (header === undefined || !header.startsWith("Bearer ")) {
        throw new AppError({
          statusCode: 401,
          code: "INTERNAL_IDENTITY_INVALID",
          message: "A valid internal service identity is required.",
        });
      }
      return {
        subject: "123456789",
        email: "cloudrun-tax@project.iam.gserviceaccount.com",
        contextUserId,
      };
    },
  };
}

async function createTaxCallbackApp(
  database: ApiDatabaseRuntime,
  identityVerifier: GoogleServiceIdentityVerifier | undefined,
) {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  registerInternalTaxCallbackRoute(app, {
    database,
    ...(identityVerifier === undefined ? {} : { internalIdentityVerifier: identityVerifier }),
  });
  return app;
}

test("internal tax callback returns 503 when identity verification is not configured", async () => {
  const database = makeDatabase(() => ({ rowCount: 0, rows: [] }));
  const app = await createTaxCallbackApp(database, undefined);

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 503);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "TAX_CALLBACK_UNAVAILABLE");
});

test("internal tax approval session binds the document before authority submission", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const database = makeDatabase((text, values) => {
    queries.push({ text, values: values ?? [] });
    return {
      rowCount: 1,
      rows: [{ bound: true, idempotent_replay: false }] as QueryResultRow[],
    };
  });
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());
  const documentId = "3b5cc006-75cb-45cb-b13d-6db90b568e14";

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/approval-session",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: { documentId, oauthSessionId: "session-approval-123" },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().data, { bound: true, idempotentReplay: false });
  assert.match(queries[0]?.text ?? "", /private\.bind_api_tax_approval_session/);
  assert.deepEqual(queries[0]?.values, [documentId, "session-approval-123"]);
});

test("internal tax callback processes a valid approved callback", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const database = makeDatabase((text, values) => {
    queries.push({ text, values: values ?? [] });
    return {
      rowCount: 1,
      rows: [{ processed: true, idempotent_replay: false }] as QueryResultRow[],
    };
  });
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.processed, true);
  assert.equal(body.data.idempotentReplay, false);

  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.values[0], "event-1234-abcd");
  assert.equal(queries[0]?.values[1], "a".repeat(64));
  assert.equal(queries[0]?.values[2], "session-abc-123");
  assert.equal(queries[0]?.values[3], "approved");
  assert.equal(queries[0]?.values[4], "CONF-2026-0001");
  assert.equal(queries[0]?.values[5], null);
  assert.equal(queries[0]?.values[6], null);
  assert.equal(queries[0]?.values[7], null);
});

test("internal tax callback reports idempotent replay", async () => {
  const database = makeDatabase(() => ({
    rowCount: 1,
    rows: [{ processed: true, idempotent_replay: true }] as QueryResultRow[],
  }));
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.processed, true);
  assert.equal(body.data.idempotentReplay, true);
});

test("internal tax callback rejects invalid body", async () => {
  const database = makeDatabase(() => ({ rowCount: 0, rows: [] }));
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: { eventId: "too-short" },
  });

  assert.equal(response.statusCode, 400);
});

test("internal tax callback maps TAX_CALLBACK_PAYLOAD_CONFLICT to 409", async () => {
  const database = makeDatabase(() => {
    const error = new Error("TAX_CALLBACK_PAYLOAD_CONFLICT") as Error & {
      code: string;
    };
    error.code = "40001";
    throw error;
  });
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 409);
  const body = response.json();
  assert.equal(body.error.code, "TAX_CALLBACK_PAYLOAD_CONFLICT");
});

test("internal tax callback maps TAX_CALLBACK_RESERVATION_NOT_FOUND to 404", async () => {
  const database = makeDatabase(() => {
    const error = new Error("TAX_CALLBACK_RESERVATION_NOT_FOUND") as Error & {
      code: string;
    };
    error.code = "P0002";
    throw error;
  });
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.error.code, "TAX_CALLBACK_TARGET_NOT_FOUND");
});

test("internal tax callback maps invalid status to 400", async () => {
  const database = makeDatabase(() => {
    const error = new Error("TAX_CALLBACK_INVALID_STATUS") as Error & {
      code: string;
    };
    error.code = "22023";
    throw error;
  });
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    headers: { authorization: "Bearer fake-identity-token" },
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error.code, "INVALID_TAX_CALLBACK");
});

test("internal tax callback rejects missing authorization header", async () => {
  const database = makeDatabase(() => ({ rowCount: 0, rows: [] }));
  const app = await createTaxCallbackApp(database, makeIdentityVerifier());

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/tax/callback",
    payload: validRequestBody,
  });

  assert.equal(response.statusCode, 401);
});
