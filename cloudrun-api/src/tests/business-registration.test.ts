import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
  ApiRequestAuthenticator,
  FirebaseUserClient,
} from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { mapDatabaseError } from "../database/errors.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
  DatabaseQueryResult,
} from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import { registerBusinessRegistrationRoutes } from "../routes/business-registration.js";

const userId = "f78661a2-4871-43ed-9ae2-2ff460ac4db5";
const internalCompanyId = "f07e8eaf-8640-4656-b32a-28884ca8ba75";
const accessToken = "header.payload.signature";

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

function authUser(emailVerified: boolean): FirebaseUserClient {
  return {
    async getUser(token) {
      assert.equal(token, accessToken);
      return {
        userId,
        email: "MANAGER@example.test",
        emailVerified,
      };
    },
  };
}

function registrationPayload() {
  return {
    workspaceMode: "business",
    displayName: "Manager Name",
    phoneNumber: "+972500000000",
    businessProfile: {
      name: "Smart Job Services",
      englishName: "Smart Job Services",
      vatNumber: "515000001",
      businessType: "Field service",
      city: "Haifa",
      address: "1 Service Road",
      phone: "+97235550000",
    },
  };
}

function successfulDatabase() {
  let requestHash: Buffer | undefined;
  let registrationCalls = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text.includes("INSERT INTO private.api_idempotency")) {
        assert.equal(values?.[0], userId);
        assert.equal(values?.[1], null);
        assert.equal(values?.[2], "business.register");
        requestHash = values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        assert.match(text, /company_id IS NOT DISTINCT FROM \$2::uuid/);
        assert.ok(requestHash);
        return result<Row>([{
          id: "63eb024d-b508-4c53-862b-fdd27f304ab9",
          request_hash: requestHash,
          response_status: null,
          response_body: null,
          completed_at: null,
          expires_at: new Date(Date.now() + 60_000),
        }]);
      }
      if (text.includes("private.register_api_business_account")) {
        registrationCalls += 1;
        assert.equal(values?.length, 15);
        assert.equal(values?.[0], "manager@example.test");
        assert.equal(values?.[1], "business");
        assert.equal(values?.[4], "Smart Job Services");
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "1001",
          tier: "Team",
        }]);
      }
      if (text.includes("WITH viewer AS") && text.includes("member_workspaces")) {
        return result<Row>([{
          public_company_id: "1001",
          name: "Smart Job Services",
          account_type: "business",
          role: "manager",
          member_no: 1,
          tier: "Team",
          enabled_modules: {
            clients: true,
            documents: true,
            inventory: true,
            solojob: true,
          },
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        assert.equal(values?.[1], 201);
        return { rowCount: 1, rows: [] as Row[] };
      }
      throw new Error(`Unexpected SQL in registration test: ${text.slice(0, 100)}`);
    },
  };
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      assert.equal(context.userId, userId);
      return work(transaction);
    },
  };
  return { database, registrationCalls: () => registrationCalls };
}

test("business registration requires a verified email before database work", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  let transactionCalls = 0;
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction() {
      transactionCalls += 1;
      throw new Error("database must not run");
    },
  };
  registerBusinessRegistrationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database,
    firebaseUsers: authUser(false),
    webSessions: {
      async currentSession() {
        throw new Error("Bearer registration must not read a web session");
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/business-registration",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": "registration-key-1234",
    },
    payload: registrationPayload(),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "VERIFIED_EMAIL_REQUIRED");
  assert.equal(transactionCalls, 0);
});

test("business registration creates one server-derived workspace atomically", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  const database = successfulDatabase();
  registerBusinessRegistrationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: database.database,
    firebaseUsers: authUser(true),
    webSessions: {
      async currentSession() {
        throw new Error("Bearer registration must not read a web session");
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/business-registration",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": "registration-key-1234",
    },
    payload: registrationPayload(),
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(database.registrationCalls(), 1);
  assert.deepEqual(response.json(), {
    ok: true,
    data: {
      workspace: {
        companyId: 1001,
        name: "Smart Job Services",
        accountType: "business",
        role: "manager",
        memberNo: 1,
        enabledModules: [
          "clients",
          "companyinventory",
          "documents",
          "inventory",
          "solojob",
          "team",
          "teaminventory",
        ],
      },
      tier: "Team",
    },
    meta: { requestId: response.headers["x-request-id"] },
  });
});

test("registration database conflicts map to safe public errors", () => {
  for (const [databaseError, expected] of [
    [{ code: "P0001", message: "ONBOARDING_ALREADY_COMPLETED" }, "ONBOARDING_ALREADY_COMPLETED"],
    [{ code: "23505", message: "duplicate key contains private value" }, "BUSINESS_REGISTRATION_CONFLICT"],
    [{ code: "22023", message: "REGISTRATION_PROFILE_INVALID" }, "INVALID_BUSINESS_REGISTRATION"],
    [{ code: "42501", message: "REGISTRATION_CONTEXT_INVALID" }, "BUSINESS_REGISTRATION_FORBIDDEN"],
  ] as const) {
    const mapped = mapDatabaseError(databaseError, "business.register");
    assert.ok(mapped instanceof AppError);
    assert.equal(mapped.code, expected);
    assert.doesNotMatch(mapped.message, /private value/);
  }
});
