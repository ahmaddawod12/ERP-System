import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import { registerWorkerMutationRoutes } from "../routes/workers-mutations.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The worker-mutation integration test only runs against a loopback database",
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
  test("worker mutations enforce team authority, replay, versions, and disable guards", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local worker-mutation integration",
  }, () => undefined);
} else {
  test("worker mutations enforce team authority, replay, versions, and disable guards", {
    timeout: 60_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const targetId = randomUUID();
    const workerCallerId = randomUUID();
    const otherManagerId = randomUUID();
    const userIds = [managerId, targetId, workerCallerId, otherManagerId];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const companyIds = [companyId, otherCompanyId];
    const managerMembershipId = randomUUID();
    const targetMembershipId = randomUUID();
    const callerMembershipId = randomUUID();
    const otherMembershipId = randomUUID();
    const publicCompanyId = 8_500_000_000_000 + randomInt(400_000);
    const otherPublicCompanyId = publicCompanyId + 1;
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES ($1, $2, $3)`,
          [userId, `worker-mutation-${userId}@example.invalid`, `Worker user ${index + 1}`],
        );
      }
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES
           ($1, $2, 'business', 'active', $3),
           ($4, $5, 'business', 'active', $6)`,
        [companyId, publicCompanyId, managerId, otherCompanyId, otherPublicCompanyId, otherManagerId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES
           ($1, 'Team', 'active', '{"team":true,"inventory":true,"jobs":true}'::jsonb),
           ($2, 'Team', 'active', '{"team":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Team manager'),
           ($4, $2, $5, 17, 'worker', 'active', 'Field technician'),
           ($6, $2, $7, 18, 'worker', 'active', 'Worker caller'),
           ($8, $9, $10, 1, 'manager', 'active', 'Other manager')`,
        [
          managerMembershipId, companyId, managerId,
          targetMembershipId, targetId,
          callerMembershipId, workerCallerId,
          otherMembershipId, otherCompanyId, otherManagerId,
        ],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "worker-integration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerWorkerMutationRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        supabaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `worker-mutation-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const updateRequest = {
        method: "PATCH" as const,
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-update-manager" },
        payload: {
          entityVersion: "ev1.MQ",
          displayName: "Lead technician",
          phoneNumber: "+972500000017",
          role: "user",
        },
      };
      const updated = await app.inject(updateRequest);
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().data.entityVersion, "ev1.Mg");
      assert.equal(updated.json().data.role, "user");
      const replay = await app.inject(updateRequest);
      assert.equal(replay.statusCode, 200, replay.body);
      assert.deepEqual(replay.json().data, updated.json().data);

      const stale = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-update-stale" },
        payload: { entityVersion: "ev1.MQ", displayName: "Stale name" },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      activeUserId = workerCallerId;
      const forbidden = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-worker-forbidden" },
        payload: { entityVersion: "ev1.Mg", displayName: "Forged name" },
      });
      assert.equal(forbidden.statusCode, 403, forbidden.body);
      assert.equal(forbidden.json().error.code, "WORKER_MUTATION_FORBIDDEN");

      activeUserId = managerId;
      const crossTenant = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${otherPublicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-cross-tenant" },
        payload: { entityVersion: "ev1.Mg", displayName: "Forged tenant" },
      });
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);
      assert.equal(crossTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      const activeJobId = randomUUID();
      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title, assigned_membership_id,
           created_by_membership_id
         ) VALUES ($1, $2, 1, 'pending', 'Active assignment', $3, $4)`,
        [activeJobId, companyId, targetMembershipId, managerMembershipId],
      );
      const activeJobBlocked = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-disable-active-job" },
        payload: { entityVersion: "ev1.Mg" },
      });
      assert.equal(activeJobBlocked.statusCode, 409, activeJobBlocked.body);
      assert.equal(activeJobBlocked.json().error.code, "WORKER_HAS_ACTIVE_JOBS");
      await admin.query("DELETE FROM public.jobs WHERE id = $1", [activeJobId]);

      const locationId = randomUUID();
      const partId = randomUUID();
      await admin.query(
        `INSERT INTO public.inventory_locations (
           id, company_id, location_type, membership_id, name
         ) VALUES ($1, $2, 'member', $3, 'Target inventory')`,
        [locationId, companyId, targetMembershipId],
      );
      await admin.query(
        `INSERT INTO public.inventory_parts (
           id, company_id, part_no, name, active, low_threshold
         ) VALUES ($1, $2, 1, 'Guarded stock', true, 0)`,
        [partId, companyId],
      );
      await admin.query(
        `INSERT INTO public.inventory_balances (location_id, part_id, quantity_on_hand)
         VALUES ($1, $2, 1)`,
        [locationId, partId],
      );
      const inventoryBlocked = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-disable-inventory" },
        payload: { entityVersion: "ev1.Mg" },
      });
      assert.equal(inventoryBlocked.statusCode, 409, inventoryBlocked.body);
      assert.equal(inventoryBlocked.json().error.code, "WORKER_HAS_INVENTORY");
      await admin.query(
        "UPDATE public.inventory_balances SET quantity_on_hand = 0 WHERE location_id = $1 AND part_id = $2",
        [locationId, partId],
      );

      const disableRequest = {
        method: "DELETE" as const,
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-disable-success" },
        payload: { entityVersion: "ev1.Mg" },
      };
      const disabled = await app.inject(disableRequest);
      assert.equal(disabled.statusCode, 200, disabled.body);
      assert.equal(disabled.json().data.status, "disabled");
      assert.equal(disabled.json().data.entityVersion, "ev1.Mw");
      const disableReplay = await app.inject(disableRequest);
      assert.equal(disableReplay.statusCode, 200, disableReplay.body);
      assert.deepEqual(disableReplay.json().data, disabled.json().data);

      const state = await admin.query(
        `SELECT membership.status::text, membership.entity_version,
                sync.workers_version
         FROM public.company_memberships AS membership
         INNER JOIN public.company_sync_state AS sync
           ON sync.company_id = membership.company_id
         WHERE membership.id = $1`,
        [targetMembershipId],
      );
      assert.deepEqual(state.rows[0], {
        status: "disabled",
        entity_version: "3",
        workers_version: 2,
      });

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{team}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const moduleForbidden = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/workers/17`,
        headers: { "idempotency-key": "worker-live-module-disabled" },
        payload: { entityVersion: "ev1.Mw", status: "active" },
      });
      assert.equal(moduleForbidden.statusCode, 403, moduleForbidden.body);
      assert.equal(moduleForbidden.json().error.code, "WORKERS_MODULE_DISABLED");

      const privileges = await admin.query(
        `SELECT
           has_function_privilege('smart_job_api', 'private.update_api_worker_membership(uuid,integer,bigint,jsonb,timestamp with time zone)', 'EXECUTE') AS can_update,
           has_function_privilege('smart_job_api', 'private.disable_api_worker_membership(uuid,integer,bigint,timestamp with time zone)', 'EXECUTE') AS can_disable,
           has_function_privilege('authenticated', 'private.update_api_worker_membership(uuid,integer,bigint,jsonb,timestamp with time zone)', 'EXECUTE') AS authenticated_can_update,
           has_table_privilege('smart_job_api', 'public.company_memberships', 'UPDATE') AS can_update_directly,
           has_table_privilege('smart_job_api', 'public.company_memberships', 'DELETE') AS can_delete_directly`,
      );
      assert.deepEqual(privileges.rows[0], {
        can_update: true,
        can_disable: true,
        authenticated_can_update: false,
        can_update_directly: false,
        can_delete_directly: false,
      });
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query(
        "DELETE FROM private.api_idempotency WHERE user_id = ANY($1::text[])",
        [userIds],
      ).catch(() => undefined);
      await admin.query(
        "DELETE FROM public.companies WHERE id = ANY($1::uuid[])",
        [companyIds],
      ).catch(() => undefined);
      await admin.query(
        "DELETE FROM public.app_users WHERE id = ANY($1::text[])",
        [userIds],
      ).catch(() => undefined);
      await admin.end();
    }
  });
}
