import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import { registerDocumentMutationRoutes } from "../routes/documents-mutations.js";

const adminDatabaseUrl = String(process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "").trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The document integration test only runs against a loopback database",
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
    async checkReadiness() { await client.query("SELECT 1"); },
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
  test("document tasks enforce atomic data, roles, replay, versions, and dispatch leases", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local document integration",
  }, () => undefined);
} else {
  test("document tasks enforce atomic data, roles, replay, versions, and dispatch leases", {
    timeout: 60_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const workerId = randomUUID();
    const otherManagerId = randomUUID();
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const membershipId = randomUUID();
    const workerMembershipId = randomUUID();
    const otherMembershipId = randomUUID();
    const clientId = randomUUID();
    const partId = randomUUID();
    const publicCompanyId = 8_600_000_000_000 + randomInt(500_000);
    const otherPublicCompanyId = publicCompanyId + 1;
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO public.app_users (id, email, display_name) VALUES
          ($1, $2, 'Document manager'),
          ($3, $4, 'Document worker'),
          ($5, $6, 'Other manager')`,
        [
          managerId, `documents-${managerId}@example.invalid`,
          workerId, `documents-${workerId}@example.invalid`,
          otherManagerId, `documents-${otherManagerId}@example.invalid`,
        ],
      );
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES
           ($1, $2, 'business', 'active', $3),
           ($4, $5, 'business', 'active', $6)`,
        [companyId, publicCompanyId, managerId, otherCompanyId, otherPublicCompanyId, otherManagerId],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (
           company_id, he_name, en_name, vat_number, business_email, business_phone, address, city
         ) VALUES
           ($1, 'חברת שירות', 'Field Service Ltd', '515123456', 'office@example.invalid', '+97235550100', '1 Main St', 'Haifa'),
           ($2, 'Other', 'Other Ltd', '515654321', 'other@example.invalid', '+97235550101', '2 Main St', 'Tel Aviv')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, status, enabled_modules) VALUES
           ($1, 'Team', 'active', '{"documents":true,"inventory":true}'::jsonb),
           ($2, 'Team', 'active', '{"documents":true,"inventory":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Document manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Document worker'),
           ($6, $7, $8, 1, 'manager', 'active', 'Other manager')`,
        [
          membershipId, companyId, managerId,
          workerMembershipId, workerId,
          otherMembershipId, otherCompanyId, otherManagerId,
        ],
      );
      await admin.query(
        `INSERT INTO public.clients (
           id, company_id, client_no, name, email, phone, city, vat_number, status
         ) VALUES ($1, $2, 1, 'Canonical Client', 'client@example.invalid', '+972501234567', 'Haifa', '515777777', 'active')`,
        [clientId, companyId],
      );
      await admin.query(
        `INSERT INTO public.inventory_parts (
           id, company_id, part_no, name, active, low_threshold
         ) VALUES ($1, $2, 1, 'Relay', true, 0)`,
        [partId, companyId],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "document-integration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerDocumentMutationRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        supabaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `documents-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const payload = {
        documentType: 200,
        documentData: {
          client: { clientId, name: "Forged Snapshot Name" },
          items: [{ description: "Relay replacement", quantity: 2, price: 50, partNo: 1 }],
          language: "he",
          date: "2026-07-13",
          notes: "Atomic document",
        },
      };
      const request = {
        method: "POST" as const,
        url: `/api/v1/companies/${publicCompanyId}/document-tasks/generate`,
        headers: { "idempotency-key": "document-live-generate-1" },
        payload,
      };
      const generated = await app.inject(request);
      assert.equal(generated.statusCode, 202, generated.body);
      assert.equal(generated.json().data.status, "pending");
      assert.equal(generated.json().data.documentCode, `DN1-${publicCompanyId}`);
      assert.equal(generated.json().data.entityVersion, "ev1.MQ");
      const documentId = String(generated.json().data.documentId);
      const taskId = String(generated.json().data.taskId);

      const replay = await app.inject(request);
      assert.equal(replay.statusCode, 202, replay.body);
      assert.deepEqual(replay.json().data, generated.json().data);
      const stored = await admin.query(
        `SELECT
           document.client_name_snapshot,
           document.total_before_vat::text,
           document.vat_amount::text,
           document.total_with_vat::text,
           document.entity_version::text,
           document.payload #>> '{company,vatNumber}' AS company_vat,
           document.payload #>> '{client,email}' AS client_email,
           item.source_inventory_part_id,
           task.status::text AS task_status,
           task.dispatch_attempts
         FROM public.documents AS document
         INNER JOIN public.document_items AS item ON item.document_id = document.id
         INNER JOIN public.document_tasks AS task ON task.document_id = document.id
         WHERE document.id = $1`,
        [documentId],
      );
      assert.deepEqual(stored.rows[0], {
        client_name_snapshot: "Canonical Client",
        total_before_vat: "100.00",
        vat_amount: "18.00",
        total_with_vat: "118.00",
        entity_version: "1",
        company_vat: "515123456",
        client_email: "client@example.invalid",
        source_inventory_part_id: partId,
        task_status: "pending",
        dispatch_attempts: 0,
      });
      assert.equal((await admin.query(
        "SELECT COUNT(*)::integer AS count FROM public.documents WHERE company_id = $1",
        [companyId],
      )).rows[0].count, 1);

      await admin.query("BEGIN");
      await admin.query("SET LOCAL ROLE smart_job_api");
      await admin.query(
        "SELECT private.set_api_request_context($1::uuid, 12000, 3000, 15000)",
        [managerId],
      );
      const leaseToken = randomUUID();
      const claimed = await admin.query(
        "SELECT * FROM private.claim_api_document_dispatch_batch($1::uuid, 1, 30, $2::text)",
        [leaseToken, taskId],
      );
      assert.equal(claimed.rowCount, 1);
      assert.equal(claimed.rows[0].task_key, taskId);
      assert.equal(claimed.rows[0].dispatch_attempt, 1);
      const completed = await admin.query(
        "SELECT private.complete_api_document_dispatch($1::text, $2::uuid, clock_timestamp()) AS completed",
        [taskId, leaseToken],
      );
      assert.equal(completed.rows[0].completed, true);
      await admin.query("COMMIT");
      assert.equal((await admin.query(
        "SELECT status::text FROM public.document_tasks WHERE task_key = $1",
        [taskId],
      )).rows[0].status, "queued");

      activeUserId = workerId;
      const workerForbidden = await app.inject({
        ...request,
        headers: { "idempotency-key": "document-live-worker" },
      });
      assert.equal(workerForbidden.statusCode, 403, workerForbidden.body);
      assert.equal(workerForbidden.json().error.code, "DOCUMENT_MUTATION_FORBIDDEN");

      activeUserId = managerId;
      const crossTenant = await app.inject({
        ...request,
        url: `/api/v1/companies/${otherPublicCompanyId}/document-tasks/generate`,
        headers: { "idempotency-key": "document-live-cross-tenant" },
      });
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);
      assert.equal(crossTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      await admin.query(
        "UPDATE public.document_tasks SET status = 'failed', completed_at = clock_timestamp() WHERE task_key = $1",
        [taskId],
      );
      await admin.query(
        "UPDATE public.documents SET notes = 'Changed concurrently' WHERE id = $1",
        [documentId],
      );
      const stale = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/documents/${documentId}`,
        headers: { "idempotency-key": "document-live-delete-stale" },
        payload: { entityVersion: "ev1.MQ" },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/documents/${documentId}`,
        headers: { "idempotency-key": "document-live-delete-current" },
        payload: { entityVersion: "ev1.Mg" },
      });
      assert.equal(removed.statusCode, 200, removed.body);
      assert.equal(removed.json().data.disposition, "deleted");
      assert.equal((await admin.query(
        "SELECT COUNT(*)::integer AS count FROM public.documents WHERE id = $1",
        [documentId],
      )).rows[0].count, 0);

      const privileges = await admin.query(
        `SELECT
           has_table_privilege('smart_job_api', 'public.documents', 'INSERT') AS document_insert,
           has_table_privilege('smart_job_api', 'public.document_tasks', 'UPDATE') AS task_update,
           has_function_privilege(
             'smart_job_api',
             'private.create_api_document_generation_task(uuid,smallint,jsonb,timestamp with time zone)',
             'EXECUTE'
           ) AS generation_execute`,
      );
      assert.deepEqual(privileges.rows[0], {
        document_insert: false,
        task_update: false,
        generation_execute: true,
      });
    } finally {
      if (app !== undefined) await app.close().catch(() => undefined);
      await admin.query("ROLLBACK").catch(() => undefined);
      await admin.query("RESET ROLE").catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = ANY($1::uuid[])", [
        [companyId, otherCompanyId],
      ]).catch(() => undefined);
      await admin.query("DELETE FROM public.app_users WHERE id = ANY($1::text[])", [
        [managerId, workerId, otherManagerId],
      ]).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });
}
