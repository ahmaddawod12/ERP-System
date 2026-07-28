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
import { registerProfileRoutes } from "../routes/profiles.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The profile integration test only runs against a loopback database",
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
  test("profile updates enforce scope, immutable VAT, and optimistic concurrency", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for profile integration",
  }, () => undefined);
} else {
  test("profile updates enforce scope, immutable VAT, and optimistic concurrency", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const workerId = randomUUID();
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const publicCompanyId = 8_200_000_000_000 + randomInt(500_000);
    const originalVatNumber = String(800_000_000 + randomInt(99_999_999));
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO public.app_users (id, email, display_name, phone_number)
         VALUES
           ($1, $2, 'Profile Manager', '+972500000001'),
           ($3, $4, 'Profile Worker', '+972500000002')`,
        [
          managerId,
          `profile-manager-${managerId}@example.invalid`,
          workerId,
          `profile-worker-${workerId}@example.invalid`,
        ],
      );
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES
           ($1, $2, 'business', 'active', $3),
           ($4, $5, 'business', 'active', $3)`,
        [companyId, publicCompanyId, managerId, otherCompanyId, publicCompanyId + 1],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (
           company_id, he_name, en_name, vat_number, business_type,
           city, address, business_email, business_phone,
           registered_by_user_id
         ) VALUES
           ($1, 'חברת בדיקה', 'Profile Fixture', $2, 'Field service',
            'Haifa', '1 Original Road', $3, '+97235550001', $4),
           ($5, 'חברה אחרת', 'Other Profile', NULL, 'Other',
            'Tel Aviv', '2 Other Road', NULL, NULL, $4)`,
        [
          companyId,
          originalVatNumber,
          `office-${managerId}@example.invalid`,
          managerId,
          otherCompanyId,
        ],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES
           ($1, 'Team', 'active', '{"jobs":true}'::jsonb),
           ($2, 'Team', 'active', '{"jobs":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           company_id, user_id, member_no, role, status, display_name, phone_number
         ) VALUES
           ($1, $2, 1, 'manager', 'active', 'Profile Manager', '+972500000001'),
           ($1, $3, 2, 'worker', 'active', 'Profile Worker', '+972500000002')`,
        [companyId, managerId, workerId],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "profile.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerProfileRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        firebaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: activeUserId === managerId
                ? `profile-manager-${managerId}@example.invalid`
                : `profile-worker-${workerId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const initial = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
      });
      assert.equal(initial.statusCode, 200, initial.body);
      const initialProfile = initial.json().data;
      assert.equal(initialProfile.vatNumber, originalVatNumber);
      assert.match(initialProfile.entityVersion, /^ev1\./u);

      const initialSelf = await app.inject({
        method: "GET",
        url: `/api/v1/me/profile?companyId=${publicCompanyId}`,
      });
      assert.equal(initialSelf.statusCode, 200, initialSelf.body);
      assert.equal(initialSelf.json().data.companyId, publicCompanyId);
      assert.equal(initialSelf.json().data.phoneNumber, "+972500000001");

      const updateBody = {
        entityVersion: initialProfile.entityVersion,
        enName: "Updated Profile Fixture",
        city: "Jerusalem",
        accountantEmail: null,
      };
      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
        headers: { "idempotency-key": "profile-company-update-1" },
        payload: updateBody,
      });
      assert.equal(update.statusCode, 200, update.body);
      assert.equal(update.json().data.enName, "Updated Profile Fixture");
      assert.equal(update.json().data.city, "Jerusalem");
      assert.equal(update.json().data.vatNumber, originalVatNumber);
      assert.notEqual(update.json().data.entityVersion, initialProfile.entityVersion);

      const replay = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
        headers: { "idempotency-key": "profile-company-update-1" },
        payload: updateBody,
      });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.deepEqual(replay.json().data, update.json().data);

      const stale = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
        headers: { "idempotency-key": "profile-company-update-2" },
        payload: { entityVersion: initialProfile.entityVersion, city: "Eilat" },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      const vatMutation = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
        headers: { "idempotency-key": "profile-company-update-3" },
        payload: {
          entityVersion: update.json().data.entityVersion,
          vatNumber: "999999999",
        },
      });
      assert.equal(vatMutation.statusCode, 400, vatMutation.body);
      assert.equal(vatMutation.json().error.code, "VALIDATION_ERROR");

      const crossTenant = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${publicCompanyId + 1}/profile`,
      });
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);

      const selfUpdate = await app.inject({
        method: "PATCH",
        url: "/api/v1/me/profile",
        headers: { "idempotency-key": "profile-viewer-update-1" },
        payload: {
          companyId: publicCompanyId,
          displayName: "Updated Manager",
          phoneNumber: null,
        },
      });
      assert.equal(selfUpdate.statusCode, 200, selfUpdate.body);
      assert.equal(selfUpdate.json().data.displayName, "Updated Manager");
      assert.equal(selfUpdate.json().data.phoneNumber, null);
      assert.equal(selfUpdate.json().data.companyId, publicCompanyId);

      const storedSelf = await admin.query(
        `SELECT app_user.display_name, app_user.phone_number,
                membership.display_name AS membership_name,
                membership.phone_number AS membership_phone
         FROM public.app_users AS app_user
         INNER JOIN public.company_memberships AS membership
           ON membership.user_id = app_user.id
          AND membership.company_id = $2
         WHERE app_user.id = $1`,
        [managerId, companyId],
      );
      assert.deepEqual(storedSelf.rows[0], {
        display_name: "Updated Manager",
        phone_number: null,
        membership_name: "Updated Manager",
        membership_phone: null,
      });

      activeUserId = workerId;
      const workerForbidden = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/profile`,
        headers: { "idempotency-key": "profile-worker-update-1" },
        payload: {
          entityVersion: update.json().data.entityVersion,
          city: "Worker City",
        },
      });
      assert.equal(workerForbidden.statusCode, 403, workerForbidden.body);
      assert.equal(workerForbidden.json().error.code, "COMPANY_PROFILE_FORBIDDEN");
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query(
        "DELETE FROM private.api_idempotency WHERE user_id IN ($1, $2)",
        [managerId, workerId],
      ).catch(() => undefined);
      await admin.query(
        "DELETE FROM public.companies WHERE id IN ($1, $2)",
        [companyId, otherCompanyId],
      ).catch(() => undefined);
      await admin.query(
        "DELETE FROM public.app_users WHERE id IN ($1, $2)",
        [managerId, workerId],
      ).catch(() => undefined);
      await admin.end();
    }
  });
}
