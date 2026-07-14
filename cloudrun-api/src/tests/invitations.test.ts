import assert from "node:assert/strict";
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
import { registerInvitationRoutes } from "../routes/invitations.js";

const userId = "f78661a2-4871-43ed-9ae2-2ff460ac4db5";
const internalCompanyId = "f07e8eaf-8640-4656-b32a-28884ca8ba75";
const membershipId = "68038ed9-fabe-46ca-a209-c89d2b9fe612";
const accessToken = "header.payload.signature";
const idempotencyId = "63eb024d-b508-4c53-862b-fdd27f304ab9";

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

function verifiedSupabaseUser(emailVerified = true): SupabaseUserClient {
  return {
    async getUser(token) {
      assert.equal(token, accessToken);
      return {
        userId,
        email: "manager@example.test",
        emailVerified,
      };
    },
  };
}

function databaseUsing(transaction: DatabaseQueryable): ApiDatabaseRuntime {
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

function managerTenantRow() {
  return {
    internal_company_id: internalCompanyId,
    public_company_id: "1001",
    name: "Smart Job Services",
    account_type: "business",
    role: "manager",
    member_no: 1,
    tier: "Team",
    enabled_modules: {
      team: true,
      clients: true,
      documents: true,
      inventory: true,
      solojob: true,
    },
  };
}

function activeIdempotencyRow(requestHash: Buffer) {
  return {
    id: idempotencyId,
    request_hash: requestHash,
    response_status: null,
    response_body: null,
    completed_at: null,
    expires_at: new Date(Date.now() + 60_000),
  };
}

function activeRateLimitRow(hitCount = 1) {
  return {
    allowed: hitCount <= 10,
    reset_at: new Date(Date.now() + 60_000),
  };
}

test("manager invitation creation resolves the public tenant and uses only the hardened private RPC", async (context) => {
  let requestHash: Buffer | undefined;
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      queries.push(values === undefined ? { text } : { text, values });
      if (text.includes("private.consume_api_invitation_rate_limit")) {
        assert.deepEqual(values, ["create"]);
        return result<Row>([activeRateLimitRow()]);
      }
      if (text.includes("WITH viewer AS") && text.includes("viewer_membership")) {
        assert.deepEqual(values, [userId, 1001]);
        return result<Row>([managerTenantRow()]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        assert.equal(values?.[0], userId);
        assert.equal(values?.[1], internalCompanyId);
        assert.equal(values?.[2], "invitation.create");
        requestHash = values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        assert.ok(requestHash);
        return result<Row>([activeIdempotencyRow(requestHash)]);
      }
      if (text.includes("private.create_api_company_invitation")) {
        assert.deepEqual(values, [
          internalCompanyId,
          "worker",
          "technician@example.test",
          30,
        ]);
        assert.doesNotMatch(text, /INSERT\s+INTO\s+public\./i);
        return result<Row>([{
          invite_id: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
          invite_code: "A1B2C3D4E5F60718293A",
          target_role: "worker",
          status: "active",
          expires_at: new Date("2026-08-12T12:00:00.000Z"),
          created_at: new Date("2026-07-13T12:00:00.000Z"),
        }]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        assert.equal(values?.[1], 201);
        return { rowCount: 1, rows: [] as Row[] };
      }
      throw new Error(`Unexpected invitation SQL: ${text.slice(0, 100)}`);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing(transaction),
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies/1001/invitations",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": "invitation-create-1234",
    },
    payload: {
      targetRole: "worker",
      targetEmail: " TECHNICIAN@example.test ",
    },
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(response.json().data, {
    inviteId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    inviteCode: "A1B2C3D4E5F60718293A",
    targetRole: "worker",
    status: "active",
    expiresAt: "2026-08-12T12:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
  });
  assert.equal(queries.filter(({ text }) => text.includes("create_api_company_invitation")).length, 1);
});

test("invitation redemption permits existing memberships in other companies and never sends uid, email, or role to SQL", async (context) => {
  let requestHash: Buffer | undefined;
  let redemptionValues: readonly unknown[] | undefined;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text.includes("private.consume_api_invitation_rate_limit")) {
        assert.deepEqual(values, ["redeem"]);
        return result<Row>([activeRateLimitRow()]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        assert.equal(values?.[0], userId);
        assert.equal(values?.[1], null);
        assert.equal(values?.[2], "invitation.redeem");
        requestHash = values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        assert.ok(requestHash);
        return result<Row>([activeIdempotencyRow(requestHash)]);
      }
      if (text.includes("private.redeem_api_company_invitation")) {
        redemptionValues = values;
        assert.deepEqual(values, [
          1001,
          "A1B2-C3D4",
          "Field Technician",
          "+972501234567",
        ]);
        assert.doesNotMatch(text, /\$5|p_uid|p_email|target_role/i);
        return result<Row>([{
          internal_company_id: internalCompanyId,
          public_company_id: "1001",
          membership_id: membershipId,
          member_no: 7,
          role: "worker",
          display_name: "Field Technician",
          joined_at: new Date("2026-07-13T12:00:00.000Z"),
        }]);
      }
      if (text.includes("WITH viewer AS") && text.includes("member_workspaces")) {
        assert.deepEqual(values, [userId]);
        return result<Row>([
          {
            public_company_id: "990",
            name: "Existing Workspace",
            account_type: "business",
            role: "manager",
            member_no: 1,
            tier: "Team",
            enabled_modules: { team: true },
          },
          {
            public_company_id: "1001",
            name: "Smart Job Services",
            account_type: "business",
            role: "worker",
            member_no: 7,
            tier: "Team",
            enabled_modules: { team: true },
          },
        ]);
      }
      if (text.includes("UPDATE private.api_idempotency")) {
        assert.equal(values?.[1], 200);
        return { rowCount: 1, rows: [] as Row[] };
      }
      throw new Error(`Unexpected invitation SQL: ${text.slice(0, 100)}`);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing(transaction),
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/invitations/redeem",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": "invitation-redeem-1234",
    },
    payload: {
      companyId: 1001,
      inviteCode: " a1b2-c3d4 ",
      displayName: " Field Technician ",
      phoneNumber: " +972501234567 ",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.ok(redemptionValues);
  assert.equal(redemptionValues.includes(userId), false);
  assert.equal(redemptionValues.includes("manager@example.test"), false);
  assert.deepEqual(response.json().data, {
    workspace: {
      companyId: 1001,
      name: "Smart Job Services",
      accountType: "business",
      role: "worker",
      memberNo: 7,
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
    membership: {
      memberNo: 7,
      role: "worker",
      displayName: "Field Technician",
      status: "active",
      joinedAt: "2026-07-13T12:00:00.000Z",
    },
  });
});

test("invitation mutations reject an unverified bearer before database work", async (context) => {
  let transactionCalls = 0;
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: {
      maxConnections: 5,
      async checkReadiness() {},
      async close() {},
      async withTransaction() {
        transactionCalls += 1;
        throw new Error("database must not run for an unverified identity");
      },
    },
    supabaseUsers: verifiedSupabaseUser(false),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/invitations/redeem",
    headers: { "idempotency-key": "invitation-redeem-1234" },
    payload: { companyId: 1001, inviteCode: "A1B2-C3D4" },
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().error.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(transactionCalls, 0);
});

test("invitation routes require idempotency before opening a transaction", async (context) => {
  let transactionCalls = 0;
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: {
      maxConnections: 5,
      async checkReadiness() {},
      async close() {},
      async withTransaction() {
        transactionCalls += 1;
        throw new Error("database must not run without idempotency");
      },
    },
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/invitations/redeem",
    payload: { companyId: 1001, inviteCode: "A1B2-C3D4" },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(transactionCalls, 0);
});

test("opaque-session invitation replay returns the completed response without Auth or invitation RPC calls", async (context) => {
  let requestHash: Buffer | undefined;
  let invitationRpcCalls = 0;
  let authUserCalls = 0;
  const replayBody = {
    workspace: {
      companyId: 1001,
      name: "Smart Job Services",
      accountType: "business",
      role: "worker",
      memberNo: 7,
      enabledModules: ["team"],
    },
    membership: {
      memberNo: 7,
      role: "worker",
      displayName: "Field Technician",
      status: "active",
      joinedAt: "2026-07-13T12:00:00.000Z",
    },
  };
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text.includes("private.consume_api_invitation_rate_limit")) {
        assert.deepEqual(values, ["redeem"]);
        return result<Row>([activeRateLimitRow()]);
      }
      if (text.includes("INSERT INTO private.api_idempotency")) {
        requestHash = values?.[4] as Buffer;
        return result<Row>([]);
      }
      if (text.includes("FROM private.api_idempotency") && text.includes("FOR UPDATE")) {
        assert.ok(requestHash);
        return result<Row>([{
          ...activeIdempotencyRow(requestHash),
          response_status: 200,
          response_body: replayBody,
          completed_at: new Date("2026-07-13T12:00:01.000Z"),
        }]);
      }
      if (text.includes("redeem_api_company_invitation")) {
        invitationRpcCalls += 1;
      }
      throw new Error(`Unexpected replay SQL: ${text.slice(0, 100)}`);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: {
      async authenticate() {
        return {
          scheme: "smart-job-session",
          userId,
          absoluteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
          sessionToken: "A".repeat(43),
        };
      },
    },
    database: databaseUsing(transaction),
    supabaseUsers: {
      async getUser() {
        authUserCalls += 1;
        throw new Error("opaque mutations must not expose the stored Auth token");
      },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/invitations/redeem",
    headers: { "idempotency-key": "invitation-redeem-replay" },
    payload: { companyId: 1001, inviteCode: "A1B2-C3D4" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().data, replayBody);
  assert.equal(invitationRpcCalls, 0);
  assert.equal(authUserCalls, 0);
});

test("invitation database state errors map to stable non-enumerating responses", async (context) => {
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing({
      async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
        if (text.includes("private.consume_api_invitation_rate_limit")) {
          assert.deepEqual(values, ["redeem"]);
          return result<Row>([activeRateLimitRow()]);
        }
        throw { code: "P0001", message: "INVITATION_EXPIRED private details" };
      },
    }),
    supabaseUsers: verifiedSupabaseUser(),
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/invitations/redeem",
    headers: { "idempotency-key": "invitation-redeem-1234" },
    payload: { companyId: 1001, inviteCode: "A1B2-C3D4" },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, "INVITATION_UNAVAILABLE");
  assert.doesNotMatch(response.body, /private details/);
});

test("invitation rate limiting fails closed and maps exhaustion to 429", async (context) => {
  let mode: "unavailable" | "exhausted" = "unavailable";
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      assert.match(text, /private\.consume_api_invitation_rate_limit/);
      assert.deepEqual(values, ["redeem"]);
      if (mode === "unavailable") throw new Error("rate-limit database unavailable");
      return result<Row>([activeRateLimitRow(11)]);
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInvitationRoutes(app, {
    authenticator: bearerAuthenticator(),
    database: databaseUsing(transaction),
    supabaseUsers: verifiedSupabaseUser(),
  });
  const request = {
    method: "POST" as const,
    url: "/api/v1/auth/invitations/redeem",
    headers: { "idempotency-key": "invitation-redeem-limited" },
    payload: { companyId: 1001, inviteCode: "A1B2-C3D4" },
  };

  const unavailable = await app.inject(request);
  assert.equal(unavailable.statusCode, 503, unavailable.body);
  assert.equal(unavailable.json().error.code, "INVITATION_RATE_LIMIT_UNAVAILABLE");
  assert.equal(unavailable.json().error.retryable, true);

  mode = "exhausted";
  const exhausted = await app.inject(request);
  assert.equal(exhausted.statusCode, 429, exhausted.body);
  assert.equal(exhausted.json().error.code, "INVITATION_RATE_LIMITED");
  assert.equal(exhausted.json().error.retryable, true);
  assert.match(exhausted.headers["retry-after"] ?? "", /^\d+$/);
});
