import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import { buildApp } from "../app.js";
import type { ApiRequestAuthenticator } from "../auth/index.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { registerJobMutationRoutes } from "../routes/job-mutations.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The job-mutation integration test only runs against a loopback database",
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
        const value = await work(transaction);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
  };
}

if (adminDatabaseUrl.length === 0) {
  test("job mutations enforce live tenancy, roles, versions, replay, guards, and grants", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local job-mutation integration",
  }, () => undefined);
} else {
  test("job mutations enforce live tenancy, roles, versions, replay, guards, and grants", {
    timeout: 60_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const workerId = randomUUID();
    const otherWorkerId = randomUUID();
    const basicId = randomUUID();
    const otherManagerId = randomUUID();
    const userIds = [managerId, workerId, otherWorkerId, basicId, otherManagerId];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const companyIds = [companyId, otherCompanyId];
    const managerMembershipId = randomUUID();
    const workerMembershipId = randomUUID();
    const otherWorkerMembershipId = randomUUID();
    const basicMembershipId = randomUUID();
    const otherManagerMembershipId = randomUUID();
    const publicCompanyId = 8_600_000_000_000 + randomInt(500_000);
    const otherPublicCompanyId = publicCompanyId + 1;
    const clientId = randomUUID();
    const otherClientId = randomUUID();
    const mutableJobId = randomUUID();
    const unassignedJobId = randomUUID();
    const managerDeleteJobId = randomUUID();
    const workerDeleteJobId = randomUUID();
    const guardedJobId = randomUUID();
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, currentUserId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES ($1, $2, $3)`,
          [
            currentUserId,
            `job-mutation-${currentUserId}@example.invalid`,
            `Job mutation user ${index + 1}`,
          ],
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
         VALUES ($1, 'Job Mutation Workspace'), ($2, 'Other Job Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (
           company_id, tier, status, enabled_modules
         ) VALUES
           ($1, 'Team', 'active', '{"solojob":true}'::jsonb),
           ($2, 'Team', 'active', '{"solojob":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Job manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Assigned worker'),
           ($6, $2, $7, 3, 'worker', 'active', 'Other worker'),
           ($8, $2, $9, 4, 'basic', 'active', 'Basic member'),
           ($10, $11, $12, 1, 'manager', 'active', 'Other manager')`,
        [
          managerMembershipId, companyId, managerId,
          workerMembershipId, workerId,
          otherWorkerMembershipId, otherWorkerId,
          basicMembershipId, basicId,
          otherManagerMembershipId, otherCompanyId, otherManagerId,
        ],
      );
      await admin.query(
        `INSERT INTO public.clients (id, company_id, client_no, status, name, phone)
         VALUES
           ($1, $2, 1, 'active', 'Northwind Cooling', '+97235550101'),
           ($3, $4, 1, 'active', 'Other Tenant Client', '+97235550102')`,
        [clientId, companyId, otherClientId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title, description,
           assigned_membership_id, created_by_membership_id
         ) VALUES
           ($1, $2, 1, 'pending', 'Mutable job', 'Initial description', $3, $4),
           ($5, $2, 2, 'waiting', 'Other worker job', 'Not assigned to viewer', $6, $4),
           ($7, $2, 3, 'denied', 'Manager delete job', 'Can be deleted', $3, $4),
           ($8, $2, 4, 'denied', 'Worker delete job', 'Worker owns it', $3, $4),
           ($9, $2, 5, 'denied', 'Guarded job', 'Has an attachment', $3, $4)`,
        [
          mutableJobId, companyId, workerMembershipId, managerMembershipId,
          unassignedJobId, otherWorkerMembershipId,
          managerDeleteJobId,
          workerDeleteJobId,
          guardedJobId,
        ],
      );
      await admin.query(
        `INSERT INTO public.job_attachments (
           id, job_id, storage_path, kind, uploaded_by_user_id
         ) VALUES ($1, $2, $3, 'photo', $4)`,
        [randomUUID(), guardedJobId, `${publicCompanyId}/guarded/photo.jpg`, managerId],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "job-integration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerJobMutationRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        supabaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `job-mutation-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const managerUpdateRequest = {
        method: "PATCH" as const,
        url: `/api/v1/companies/${publicCompanyId}/jobs/${mutableJobId}`,
        headers: { "idempotency-key": "job-live-manager-update" },
        payload: {
          entityVersion: encodeEntityVersion(1),
          title: "Updated emergency relay",
          clientId,
          assigneeMemberNo: 2,
          status: "waiting",
        },
      };
      const updated = await app.inject(managerUpdateRequest);
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().data.entityVersion, encodeEntityVersion(2));
      assert.equal(updated.json().data.client.id, clientId);
      assert.equal(updated.json().data.assignee.memberNo, 2);
      const replayedUpdate = await app.inject(managerUpdateRequest);
      assert.equal(replayedUpdate.statusCode, 200, replayedUpdate.body);
      assert.deepEqual(replayedUpdate.json().data, updated.json().data);

      const persistedUpdate = await admin.query(
        `SELECT
           title,
           status::text AS status,
           client_id,
           client_name_snapshot,
           assigned_membership_id,
           entity_version
         FROM public.jobs
         WHERE id = $1`,
        [mutableJobId],
      );
      assert.deepEqual(persistedUpdate.rows[0], {
        title: "Updated emergency relay",
        status: "waiting",
        client_id: clientId,
        client_name_snapshot: "Northwind Cooling",
        assigned_membership_id: workerMembershipId,
        entity_version: "2",
      });

      const stale = await app.inject({
        method: "PATCH",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-stale-update" },
        payload: { entityVersion: encodeEntityVersion(1), notes: "stale" },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      activeUserId = workerId;
      const workerUpdate = await app.inject({
        method: "PATCH",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-worker-update" },
        payload: { entityVersion: encodeEntityVersion(2), notes: "Checked on site" },
      });
      assert.equal(workerUpdate.statusCode, 200, workerUpdate.body);
      assert.equal(workerUpdate.json().data.entityVersion, encodeEntityVersion(3));

      const workerAuthorityForgery = await app.inject({
        method: "PATCH",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-worker-authority" },
        payload: { entityVersion: encodeEntityVersion(3), clientId: null },
      });
      assert.equal(workerAuthorityForgery.statusCode, 403, workerAuthorityForgery.body);
      assert.equal(workerAuthorityForgery.json().error.code, "JOB_UPDATE_FORBIDDEN");

      const workerCrossAssignment = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${publicCompanyId}/jobs/${unassignedJobId}`,
        headers: { "idempotency-key": "job-live-worker-unassigned" },
        payload: { entityVersion: encodeEntityVersion(1), notes: "forged" },
      });
      assert.equal(workerCrossAssignment.statusCode, 403, workerCrossAssignment.body);

      const workerAccept = await app.inject({
        method: "POST",
        url: `${managerUpdateRequest.url}/accept`,
        headers: { "idempotency-key": "job-live-worker-accept" },
        payload: { entityVersion: encodeEntityVersion(3) },
      });
      assert.equal(workerAccept.statusCode, 403, workerAccept.body);
      assert.equal(workerAccept.json().error.code, "JOB_ACCEPT_FORBIDDEN");

      const workerPendingDelete = await app.inject({
        method: "DELETE",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-worker-delete-pending" },
        payload: { entityVersion: encodeEntityVersion(3) },
      });
      assert.equal(workerPendingDelete.statusCode, 403, workerPendingDelete.body);
      assert.equal(workerPendingDelete.json().error.code, "JOB_DELETE_FORBIDDEN");

      activeUserId = managerId;
      const acceptRequest = {
        method: "POST" as const,
        url: `${managerUpdateRequest.url}/accept`,
        headers: { "idempotency-key": "job-live-manager-accept" },
        payload: { entityVersion: encodeEntityVersion(3) },
      };
      const accepted = await app.inject(acceptRequest);
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().data.status, "finished");
      assert.equal(accepted.json().data.entityVersion, encodeEntityVersion(4));
      assert.ok(accepted.json().data.finishedAt);
      const replayedAccept = await app.inject(acceptRequest);
      assert.deepEqual(replayedAccept.json().data, accepted.json().data);

      const repeatedAccept = await app.inject({
        ...acceptRequest,
        headers: { "idempotency-key": "job-live-repeat-accept" },
        payload: { entityVersion: encodeEntityVersion(4) },
      });
      assert.equal(repeatedAccept.statusCode, 409, repeatedAccept.body);
      assert.equal(repeatedAccept.json().error.code, "JOB_NOT_ACCEPTABLE");

      const guardedDelete = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/jobs/${guardedJobId}`,
        headers: { "idempotency-key": "job-live-guarded-delete" },
        payload: { entityVersion: encodeEntityVersion(1) },
      });
      assert.equal(guardedDelete.statusCode, 409, guardedDelete.body);
      assert.equal(guardedDelete.json().error.code, "JOB_DELETE_CONFLICT");

      const managerDeleteRequest = {
        method: "DELETE" as const,
        url: `/api/v1/companies/${publicCompanyId}/jobs/${managerDeleteJobId}`,
        headers: { "idempotency-key": "job-live-manager-delete" },
        payload: { entityVersion: encodeEntityVersion(1) },
      };
      const managerDeleted = await app.inject(managerDeleteRequest);
      assert.equal(managerDeleted.statusCode, 200, managerDeleted.body);
      assert.deepEqual(managerDeleted.json().data, {
        jobId: managerDeleteJobId,
        jobNo: 3,
        deleted: true,
      });
      const managerDeleteReplay = await app.inject(managerDeleteRequest);
      assert.deepEqual(managerDeleteReplay.json().data, managerDeleted.json().data);

      activeUserId = workerId;
      const workerDeleted = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/jobs/${workerDeleteJobId}`,
        headers: { "idempotency-key": "job-live-worker-delete-own" },
        payload: { entityVersion: encodeEntityVersion(1) },
      });
      assert.equal(workerDeleted.statusCode, 200, workerDeleted.body);
      assert.equal(workerDeleted.json().data.deleted, true);

      activeUserId = managerId;
      const crossTenant = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${otherPublicCompanyId}/jobs/${mutableJobId}`,
        headers: { "idempotency-key": "job-live-cross-tenant" },
        payload: { entityVersion: encodeEntityVersion(4), notes: "forged" },
      });
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);
      assert.equal(crossTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      activeUserId = basicId;
      const basicForbidden = await app.inject({
        method: "PATCH",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-basic-update" },
        payload: { entityVersion: encodeEntityVersion(4), notes: "forged" },
      });
      assert.equal(basicForbidden.statusCode, 403, basicForbidden.body);
      assert.equal(basicForbidden.json().error.code, "JOB_UPDATE_FORBIDDEN");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = '{"solojob":false}'::jsonb
         WHERE company_id = $1`,
        [companyId],
      );
      activeUserId = managerId;
      const moduleForbidden = await app.inject({
        method: "PATCH",
        url: managerUpdateRequest.url,
        headers: { "idempotency-key": "job-live-module-disabled" },
        payload: { entityVersion: encodeEntityVersion(4), notes: "disabled" },
      });
      assert.equal(moduleForbidden.statusCode, 403, moduleForbidden.body);
      assert.equal(moduleForbidden.json().error.code, "JOB_UPDATE_FORBIDDEN");

      const syncState = await admin.query(
        `SELECT jobs_version
         FROM public.company_sync_state
         WHERE company_id = $1`,
        [companyId],
      );
      assert.equal(syncState.rows[0].jobs_version, 5);

      const remainingJobs = await admin.query(
        `SELECT id FROM public.jobs
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
        [[managerDeleteJobId, workerDeleteJobId]],
      );
      assert.equal(remainingJobs.rowCount, 0);

      const privileges = await admin.query(
        `SELECT
           has_function_privilege('smart_job_api', 'private.update_api_job(uuid,uuid,bigint,jsonb,timestamp with time zone)', 'EXECUTE') AS can_update,
           has_function_privilege('smart_job_api', 'private.accept_api_job(uuid,uuid,bigint,timestamp with time zone)', 'EXECUTE') AS can_accept,
           has_function_privilege('smart_job_api', 'private.delete_api_job(uuid,uuid,bigint)', 'EXECUTE') AS can_delete,
           has_function_privilege('smart_job_api', 'private.validate_api_job_patch(jsonb)', 'EXECUTE') AS can_call_helper,
           has_function_privilege('authenticated', 'private.update_api_job(uuid,uuid,bigint,jsonb,timestamp with time zone)', 'EXECUTE') AS authenticated_can_update,
           has_table_privilege('smart_job_api', 'public.jobs', 'UPDATE') AS can_update_directly,
           has_table_privilege('smart_job_api', 'public.jobs', 'DELETE') AS can_delete_directly`,
      );
      assert.deepEqual(privileges.rows[0], {
        can_update: true,
        can_accept: true,
        can_delete: true,
        can_call_helper: false,
        authenticated_can_update: false,
        can_update_directly: false,
        can_delete_directly: false,
      });
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query(
        "DELETE FROM private.api_idempotency WHERE user_id = ANY($1::uuid[])",
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
