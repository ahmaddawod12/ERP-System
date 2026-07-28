import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerBusinessRegistrationRoutes } from "../routes/business-registration.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The business-registration integration test only runs against a loopback database",
  );
  return url;
}

function contextualRuntime(client: Client): ApiDatabaseRuntime {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      const result = await client.query<Row>(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };

  return {
    maxConnections: 1,
    async checkReadiness() {
      await client.query("SELECT 1");
    },
    async close() {},
    async withTransaction(context, work) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE smart_job_api");
        await client.query(
          "SELECT private.set_api_request_context($1::uuid, 12000, 3000, 15000)",
          [context.userId],
        );
        const result = await work(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
  };
}

if (adminDatabaseUrl.length === 0) {
  test("business registration is atomic and globally idempotent against local Postgres", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for registration integration",
  }, () => undefined);
} else {
  test("business registration is atomic and globally idempotent against local Postgres", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const userId = randomUUID();
    const verifiedEmail = `api-registration-${userId}@example.invalid`;
    const vatNumber = String(700_000_000 + randomInt(99_999_999));
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId,
            expiresAt: 4_102_444_800,
            accessToken: "registration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerBusinessRegistrationRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        firebaseUsers: {
          async getUser(token) {
            assert.equal(token, "registration.payload.signature");
            return { userId, email: verifiedEmail, emailVerified: true };
          },
        },
        webSessions: {
          async currentSession() {
            throw new Error("Bearer integration must not resolve a web session");
          },
        },
      });

      const payload = {
        workspaceMode: "business",
        displayName: "Integration Manager",
        phoneNumber: "+972500000000",
        businessProfile: {
          name: "Integration Field Service",
          englishName: "Integration Field Service",
          vatNumber,
          businessType: "Field service",
          city: "Haifa",
          address: "1 Integration Road",
          phone: "+97235550000",
        },
      };
      const request = (idempotencyKey: string, body = payload) => app?.inject({
        method: "POST",
        url: "/api/v1/auth/business-registration",
        headers: {
          authorization: "Bearer registration.payload.signature",
          "idempotency-key": idempotencyKey,
        },
        payload: body,
      });

      const first = await request("registration-integration-key-1");
      assert.ok(first);
      assert.equal(first.statusCode, 201, first.body);
      assert.equal(first.json().data.workspace.role, "manager");
      assert.equal(first.json().data.workspace.accountType, "business");
      assert.equal(first.json().data.tier, "Team");
      assert.equal(first.json().data.workspace.enabledModules.includes("clients"), true);

      const replay = await request("registration-integration-key-1");
      assert.ok(replay);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json().data, first.json().data);

      const reused = await request("registration-integration-key-1", {
        ...payload,
        displayName: "Changed Manager",
      });
      assert.ok(reused);
      assert.equal(reused.statusCode, 409, reused.body);
      assert.equal(reused.json().error.code, "IDEMPOTENCY_KEY_REUSED");

      const secondWorkspace = await request("registration-integration-key-2");
      assert.ok(secondWorkspace);
      assert.equal(secondWorkspace.statusCode, 409, secondWorkspace.body);
      assert.equal(secondWorkspace.json().error.code, "ONBOARDING_ALREADY_COMPLETED");

      const stored = await admin.query(
        `SELECT company.id, company.public_company_id, profile.business_email,
                membership.role::text AS role
         FROM public.companies AS company
         INNER JOIN public.company_profiles AS profile ON profile.company_id = company.id
         INNER JOIN public.company_memberships AS membership ON membership.company_id = company.id
         WHERE company.created_by_user_id = $1`,
        [userId],
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0].business_email, verifiedEmail);
      assert.equal(stored.rows[0].role, "manager");
      assert.equal(Number(stored.rows[0].public_company_id), first.json().data.workspace.companyId);
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query("DELETE FROM private.api_idempotency WHERE user_id = $1", [userId])
        .catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE created_by_user_id = $1", [userId])
        .catch(() => undefined);
      await admin.query("DELETE FROM public.app_users WHERE id = $1", [userId])
        .catch(() => undefined);
      await admin.end();
    }
  });
}
