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
import { registerContactRequestRoutes } from "../routes/contact-requests.js";
import { registerUpgradeRequestRoutes } from "../routes/upgrade-requests.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "Upgrade/contact integration tests only run against a loopback database",
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
  test("upgrade/contact APIs enforce SQL authority, idempotency, and atomic moderation", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for upgrade/contact integration",
  }, () => undefined);
} else {
  test("upgrade/contact APIs enforce SQL authority, idempotency, and atomic moderation", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const developerId = randomUUID();
    const outsiderId = randomUUID();
    const companyId = randomUUID();
    const publicCompanyId = 8_500_000_000_000 + randomInt(500_000);
    const managerEmail = `upgrade-manager-${managerId}@example.invalid`;
    const developerEmail = `upgrade-dev-${developerId}@example.invalid`;
    const outsiderEmail = `upgrade-outsider-${outsiderId}@example.invalid`;
    const contactEmail = `contact-${randomUUID()}@example.invalid`;
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    let contactRequestId: string | undefined;

    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO public.app_users (id, email, display_name, system_role)
         VALUES
           ($1, $2, 'Upgrade Manager', NULL),
           ($3, $4, 'Upgrade Developer', 'dev'),
           ($5, $6, 'Upgrade Outsider', NULL)`,
        [managerId, managerEmail, developerId, developerEmail, outsiderId, outsiderEmail],
      );
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES ($1, $2, 'business', 'active', $3)`,
        [companyId, publicCompanyId, managerId],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (company_id, en_name, registered_by_user_id)
         VALUES ($1, 'Upgrade Fixture', $2)`,
        [companyId, managerId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES ($1, 'Team', 'active', '{"team":true}'::jsonb)`,
        [companyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           company_id, user_id, member_no, role, status, display_name
         ) VALUES ($1, $2, 1, 'manager', 'active', 'Upgrade Manager')`,
        [companyId, managerId],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "upgrade.payload.signature",
          };
        },
      };
      const database = contextualRuntime(admin);
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerContactRequestRoutes(app, { database });
      registerUpgradeRequestRoutes(app, {
        authenticator,
        database,
        firebaseUsers: {
          async getUser() {
            const emails = new Map([
              [managerId, managerEmail],
              [developerId, developerEmail],
              [outsiderId, outsiderEmail],
            ]);
            return {
              userId: activeUserId,
              email: emails.get(activeUserId) ?? null,
              emailVerified: true,
            };
          },
        },
      });

      const contactPayload = {
        name: "Contact Fixture",
        email: contactEmail,
        company: "Contact Company",
        subject: "ERP rollout",
        message: "Please contact us about a field-service rollout.",
      };
      const contact = await app.inject({
        method: "POST",
        url: "/api/v1/contact-requests",
        headers: { "idempotency-key": "contact-integration-key-1" },
        payload: contactPayload,
      });
      assert.equal(contact.statusCode, 201, contact.body);
      contactRequestId = contact.json().data.requestId;
      assert.equal(contact.json().data.status, "received");

      const contactReplay = await app.inject({
        method: "POST",
        url: "/api/v1/contact-requests",
        headers: { "idempotency-key": "contact-integration-key-1" },
        payload: contactPayload,
      });
      assert.equal(contactReplay.statusCode, 201, contactReplay.body);
      assert.equal(contactReplay.json().data.requestId, contactRequestId);
      const storedContact = await admin.query(
        `SELECT name, email, company, subject, count(*) OVER ()::integer AS count
         FROM public.contact_requests WHERE id = $1`,
        [contactRequestId],
      );
      assert.deepEqual(storedContact.rows[0], {
        name: contactPayload.name,
        email: contactEmail,
        company: contactPayload.company,
        subject: contactPayload.subject,
        count: 1,
      });
      const contactLimit = await admin.query(
        `SELECT hit_count
         FROM public.rate_limit_buckets
         WHERE hashed_key = pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to('api-contact-request:' || $1::text, 'UTF8'),
             'sha256'
           ),
           'hex'
         )
         ORDER BY updated_at DESC
         LIMIT 1`,
        [contactEmail],
      );
      assert.equal(contactLimit.rows[0].hit_count, 1);

      const createPayload = {
        companyId: publicCompanyId,
        requestedTier: "Enterprise",
        message: "We need the enterprise tier for a larger field team.",
      };
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/upgrade-requests",
        headers: { "idempotency-key": "upgrade-integration-key-1" },
        payload: createPayload,
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().data.companyId, publicCompanyId);
      assert.equal(created.json().data.role, "manager");
      assert.equal(created.json().data.currentTier, "Team");
      assert.equal(created.json().data.requestedTier, "Enterprise");
      const upgradeRequestId = String(created.json().data.requestId);
      const initialVersion = String(created.json().data.entityVersion);

      const createReplay = await app.inject({
        method: "POST",
        url: "/api/v1/upgrade-requests",
        headers: { "idempotency-key": "upgrade-integration-key-1" },
        payload: createPayload,
      });
      assert.equal(createReplay.statusCode, 201, createReplay.body);
      assert.equal(createReplay.json().data.requestId, upgradeRequestId);
      const upgradeLimit = await admin.query(
        `SELECT hit_count
         FROM public.rate_limit_buckets
         WHERE hashed_key = pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to('api-upgrade-request:' || $1::text, 'UTF8'),
             'sha256'
           ),
           'hex'
         )
         ORDER BY updated_at DESC
         LIMIT 1`,
        [managerId],
      );
      assert.equal(upgradeLimit.rows[0].hit_count, 1);

      activeUserId = outsiderId;
      const forgedTenant = await app.inject({
        method: "POST",
        url: "/api/v1/upgrade-requests",
        headers: { "idempotency-key": "upgrade-outsider-key-1" },
        payload: createPayload,
      });
      assert.equal(forgedTenant.statusCode, 404, forgedTenant.body);

      activeUserId = managerId;
      const managerList = await app.inject({
        method: "GET",
        url: "/api/v1/upgrade-requests?pageSize=50",
      });
      assert.equal(managerList.statusCode, 403, managerList.body);

      activeUserId = developerId;
      const developerList = await app.inject({
        method: "GET",
        url: "/api/v1/upgrade-requests?status=pending&pageSize=1",
      });
      assert.equal(developerList.statusCode, 200, developerList.body);
      assert.equal(developerList.json().data.items[0].requestId, upgradeRequestId);

      const approved = await app.inject({
        method: "PATCH",
        url: `/api/v1/upgrade-requests/${upgradeRequestId}`,
        headers: { "idempotency-key": "upgrade-moderation-key-1" },
        payload: {
          status: "approved",
          moderationNote: "Approved for the field-team rollout.",
          entityVersion: initialVersion,
        },
      });
      assert.equal(approved.statusCode, 200, approved.body);
      assert.equal(approved.json().data.status, "approved");
      assert.notEqual(approved.json().data.entityVersion, initialVersion);
      assert.ok(approved.json().data.appliedAt);

      const approvalReplay = await app.inject({
        method: "PATCH",
        url: `/api/v1/upgrade-requests/${upgradeRequestId}`,
        headers: { "idempotency-key": "upgrade-moderation-key-1" },
        payload: {
          status: "approved",
          moderationNote: "Approved for the field-team rollout.",
          entityVersion: initialVersion,
        },
      });
      assert.equal(approvalReplay.statusCode, 200, approvalReplay.body);
      assert.deepEqual(approvalReplay.json().data, approved.json().data);

      const stale = await app.inject({
        method: "PATCH",
        url: `/api/v1/upgrade-requests/${upgradeRequestId}`,
        headers: { "idempotency-key": "upgrade-moderation-key-2" },
        payload: {
          status: "rejected",
          entityVersion: initialVersion,
        },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      const subscription = await admin.query(
        `SELECT tier::text AS tier, enabled_modules
         FROM public.company_subscriptions WHERE company_id = $1`,
        [companyId],
      );
      assert.equal(subscription.rows[0].tier, "Enterprise");
      assert.equal(subscription.rows[0].enabled_modules.team, true);
      assert.equal(subscription.rows[0].enabled_modules.inventory, true);
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query(
        `DELETE FROM private.api_idempotency
         WHERE user_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
        [
          managerId,
          developerId,
          outsiderId,
          "00000000-0000-0000-0000-000000000001",
        ],
      ).catch(() => undefined);
      if (contactRequestId !== undefined) {
        await admin.query("DELETE FROM public.contact_requests WHERE id = $1", [contactRequestId])
          .catch(() => undefined);
      }
      await admin.query(
        "DELETE FROM public.upgrade_requests WHERE uid IN ($1, $2, $3)",
        [managerId, developerId, outsiderId],
      ).catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = $1", [companyId])
        .catch(() => undefined);
      await admin.query(
        "DELETE FROM public.app_users WHERE id IN ($1, $2, $3)",
        [managerId, developerId, outsiderId],
      ).catch(() => undefined);
      await admin.end();
    }
  });
}
