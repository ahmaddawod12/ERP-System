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
import { registerClientMutationRoutes } from "../routes/clients-mutations.js";
import { registerClientsReadRoutes } from "../routes/clients-read.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The client-mutation integration test only runs against a loopback database",
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

async function createConcurrentClient(
  databaseUrl: URL,
  userId: string,
  companyId: string,
  name: string,
) {
  const client = new Client({ connectionString: databaseUrl.href, ssl: false });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE smart_job_api");
    await client.query(
      "SELECT private.set_api_request_context($1::uuid, 12000, 3000, 15000)",
      [userId],
    );
    const created = await client.query(
      `SELECT * FROM private.create_api_client(
         $1::uuid,
         jsonb_build_object('name', $2::text),
         clock_timestamp()
       )`,
      [companyId, name],
    );
    await client.query("COMMIT");
    return created.rows[0] as { client_id: string; client_no: number };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (adminDatabaseUrl.length === 0) {
  test("client mutations enforce tenancy, roles, replay, versions, references, and counters", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local client-mutation integration",
  }, () => undefined);
} else {
  test("client mutations enforce tenancy, roles, replay, versions, references, and counters", {
    timeout: 60_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const workerId = randomUUID();
    const basicId = randomUUID();
    const otherManagerId = randomUUID();
    const userIds = [managerId, workerId, basicId, otherManagerId];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const companyIds = [companyId, otherCompanyId];
    const membershipIds = Array.from({ length: 4 }, () => randomUUID());
    const publicCompanyId = 8_400_000_000_000 + randomInt(500_000);
    const otherPublicCompanyId = publicCompanyId + 1;
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES ($1, $2, $3)`,
          [userId, `client-mutation-${userId}@example.invalid`, `Client user ${index + 1}`],
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
        `INSERT INTO public.company_profiles (company_id, he_name)
         VALUES ($1, 'Client Mutation Workspace'), ($2, 'Other Client Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES
           ($1, 'Team', 'active', '{"clients":true}'::jsonb),
           ($2, 'Team', 'active', '{"clients":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Client manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Client worker'),
           ($6, $2, $7, 3, 'basic', 'active', 'Client basic'),
           ($8, $9, $10, 1, 'manager', 'active', 'Other manager')`,
        [
          membershipIds[0], companyId, managerId,
          membershipIds[1], workerId,
          membershipIds[2], basicId,
          membershipIds[3], otherCompanyId, otherManagerId,
        ],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "client-integration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      const services = {
        authenticator,
        database: contextualRuntime(admin),
        supabaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `client-mutation-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      };
      registerClientMutationRoutes(app, services);
      registerClientsReadRoutes(app, services);

      const createManager = () => app?.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/clients`,
        headers: { "idempotency-key": "client-live-create-manager" },
        payload: {
          name: "Northwind Cooling",
          email: "DISPATCH@northwind.example",
          vatNumber: "515987654",
        },
      });
      const created = await createManager();
      assert.ok(created);
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().data.clientNo, 1);
      assert.equal(created.json().data.entityVersion, "ev1.MQ");
      const firstClientId = String(created.json().data.clientId);

      const replay = await createManager();
      assert.ok(replay);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json().data, created.json().data);
      const afterReplay = await admin.query(
        "SELECT COUNT(*)::integer AS count FROM public.clients WHERE company_id = $1",
        [companyId],
      );
      assert.equal(afterReplay.rows[0].count, 1);

      const updated = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/clients/${firstClientId}`,
        headers: { "idempotency-key": "client-live-update-manager" },
        payload: {
          entityVersion: created.json().data.entityVersion,
          name: "Northwind Cooling Ltd.",
          city: "Haifa",
        },
      });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().data.entityVersion, "ev1.Mg");

      const stale = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/clients/${firstClientId}`,
        headers: { "idempotency-key": "client-live-update-stale" },
        payload: {
          entityVersion: created.json().data.entityVersion,
          city: "Eilat",
        },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      activeUserId = workerId;
      const workerForbidden = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/clients`,
        headers: { "idempotency-key": "client-live-worker-create" },
        payload: { name: "Forged Worker Client" },
      });
      assert.equal(workerForbidden.statusCode, 403, workerForbidden.body);
      assert.equal(workerForbidden.json().error.code, "CLIENT_MUTATION_FORBIDDEN");

      activeUserId = managerId;
      const crossTenant = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${otherPublicCompanyId}/clients`,
        headers: { "idempotency-key": "client-live-cross-tenant" },
        payload: { name: "Forged Other Tenant Client" },
      });
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);
      assert.equal(crossTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      activeUserId = basicId;
      const basicCreated = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/clients`,
        headers: { "idempotency-key": "client-live-basic-create" },
        payload: { name: "Basic Account Client" },
      });
      assert.equal(basicCreated.statusCode, 201, basicCreated.body);
      assert.equal(basicCreated.json().data.clientNo, 2);

      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title, client_id, created_by_membership_id
         ) VALUES ($1, $2, 1, 'pending', 'Referenced client job', $3, $4)`,
        [randomUUID(), companyId, firstClientId, membershipIds[0]],
      );
      activeUserId = managerId;
      const archived = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/clients/${firstClientId}`,
        headers: { "idempotency-key": "client-live-remove-referenced" },
        payload: { entityVersion: updated.json().data.entityVersion },
      });
      assert.equal(archived.statusCode, 200, archived.body);
      assert.equal(archived.json().data.disposition, "archived");
      assert.equal(archived.json().data.entityVersion, "ev1.Mw");
      assert.ok(archived.json().data.archivedAt);

      const defaultActive = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${publicCompanyId}/clients`,
      });
      assert.equal(defaultActive.statusCode, 200, defaultActive.body);
      assert.equal(
        defaultActive.json().data.items.some((client: { clientId: string }) => client.clientId === firstClientId),
        false,
      );
      const archivedPage = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${publicCompanyId}/clients?status=archived`,
      });
      assert.equal(archivedPage.statusCode, 200, archivedPage.body);
      assert.deepEqual(
        archivedPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        [firstClientId],
      );

      const secondClientId = String(basicCreated.json().data.clientId);
      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/clients/${secondClientId}`,
        headers: { "idempotency-key": "client-live-remove-unreferenced" },
        payload: { entityVersion: basicCreated.json().data.entityVersion },
      });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.deepEqual(deleted.json().data, {
        clientId: secondClientId,
        clientNo: 2,
        disposition: "deleted",
        entityVersion: null,
        archivedAt: null,
      });
      const deletedRow = await admin.query(
        "SELECT id FROM public.clients WHERE id = $1",
        [secondClientId],
      );
      assert.equal(deletedRow.rowCount, 0);

      const concurrent = await Promise.all([
        createConcurrentClient(databaseUrl, managerId, companyId, "Concurrent Client A"),
        createConcurrentClient(databaseUrl, managerId, companyId, "Concurrent Client B"),
      ]);
      assert.deepEqual(
        concurrent.map(({ client_no: clientNo }) => clientNo).sort((left, right) => left - right),
        [3, 4],
      );
      assert.equal(new Set(concurrent.map(({ client_id: id }) => id)).size, 2);

      const state = await admin.query(
        `SELECT
           sync.clients_version,
           counter.next_value,
           COUNT(client.id)::integer AS stored_clients,
           COUNT(client.id) FILTER (WHERE client.status = 'archived')::integer AS archived_clients
         FROM public.company_sync_state AS sync
         INNER JOIN public.company_counters AS counter
           ON counter.company_id = sync.company_id
          AND counter.counter_key = 'client_no'
         LEFT JOIN public.clients AS client
           ON client.company_id = sync.company_id
         WHERE sync.company_id = $1
         GROUP BY sync.clients_version, counter.next_value`,
        [companyId],
      );
      assert.deepEqual(state.rows[0], {
        clients_version: 7,
        next_value: 5,
        stored_clients: 3,
        archived_clients: 1,
      });

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{clients}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const moduleForbidden = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/clients`,
        headers: { "idempotency-key": "client-live-module-disabled" },
        payload: { name: "Disabled Module Client" },
      });
      assert.equal(moduleForbidden.statusCode, 403, moduleForbidden.body);
      assert.equal(moduleForbidden.json().error.code, "CLIENTS_MODULE_DISABLED");

      const privileges = await admin.query(
        `SELECT
           has_function_privilege('smart_job_api', 'private.create_api_client(uuid,jsonb,timestamp with time zone)', 'EXECUTE') AS can_create,
           has_function_privilege('smart_job_api', 'private.update_api_client(uuid,uuid,bigint,jsonb,timestamp with time zone)', 'EXECUTE') AS can_update,
           has_function_privilege('smart_job_api', 'private.delete_or_archive_api_client(uuid,uuid,bigint,timestamp with time zone)', 'EXECUTE') AS can_remove,
           has_function_privilege('authenticated', 'private.create_api_client(uuid,jsonb,timestamp with time zone)', 'EXECUTE') AS authenticated_can_create,
           has_table_privilege('smart_job_api', 'public.clients', 'INSERT') AS can_insert_directly,
           has_table_privilege('smart_job_api', 'public.clients', 'UPDATE') AS can_update_directly,
           has_table_privilege('smart_job_api', 'public.clients', 'DELETE') AS can_delete_directly`,
      );
      assert.deepEqual(privileges.rows[0], {
        can_create: true,
        can_update: true,
        can_remove: true,
        authenticated_can_create: false,
        can_insert_directly: false,
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
