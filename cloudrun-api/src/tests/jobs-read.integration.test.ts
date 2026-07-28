import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type FirebaseTokenVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerJobsReadRoutes } from "../routes/jobs-read.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The jobs-read integration test only runs against a loopback database",
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
  test("job reads enforce live tenant, role, entitlement, and microsecond cursor behavior", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local jobs-read integration",
  }, () => undefined);
} else {
  test("job reads enforce live tenant, role, entitlement, and microsecond cursor behavior", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerUid = randomUUID();
    const workerUid = randomUUID();
    const businessUid = randomUUID();
    const basicUid = randomUUID();
    const otherManagerUid = randomUUID();
    const userIds = [managerUid, workerUid, businessUid, basicUid, otherManagerUid];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const publicCompanyId = 8_000_000_000 + randomInt(1_000_000);
    const otherPublicCompanyId = 8_100_000_000 + randomInt(1_000_000);
    const managerMembershipId = randomUUID();
    const workerMembershipId = randomUUID();
    const businessMembershipId = randomUUID();
    const basicMembershipId = randomUUID();
    const otherManagerMembershipId = randomUUID();
    const precisionJobIds = Array.from({ length: 2 }, () => randomUUID()).sort().reverse();
    const jobIds = [
      precisionJobIds[0]!,
      precisionJobIds[1]!,
      ...Array.from({ length: 5 }, () => randomUUID()),
    ];
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES ($1, $2, $3)`,
          [userId, `jobs-read-${userId}@example.invalid`, `Read user ${index + 1}`],
        );
      }
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES
           ($1, $2, 'business', 'active', $3),
           ($4, $5, 'business', 'active', $6)`,
        [
          companyId,
          publicCompanyId,
          managerUid,
          otherCompanyId,
          otherPublicCompanyId,
          otherManagerUid,
        ],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (company_id, he_name)
         VALUES ($1, 'Jobs Read Workspace'), ($2, 'Other Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, enabled_modules)
         VALUES
           ($1, 'Team', '{"solojob":true}'::jsonb),
           ($2, 'Team', '{"solojob":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Read manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Read worker'),
           ($6, $2, $7, 3, 'user', 'active', 'Read business user'),
           ($8, $2, $9, 4, 'basic', 'active', 'Read basic user'),
           ($10, $11, $12, 1, 'manager', 'active', 'Other manager')`,
        [
          managerMembershipId,
          companyId,
          managerUid,
          workerMembershipId,
          workerUid,
          businessMembershipId,
          businessUid,
          basicMembershipId,
          basicUid,
          otherManagerMembershipId,
          otherCompanyId,
          otherManagerUid,
        ],
      );

      const seededJobs = [
        [jobIds[0], 1, "pending", "Pump alpha", workerMembershipId, managerMembershipId, "2026-07-13T12:00:00.123456Z"],
        [jobIds[1], 2, "pending", "Pump beta", businessMembershipId, managerMembershipId, "2026-07-13T12:00:00.123456Z"],
        [jobIds[2], 3, "waiting", "Compressor", workerMembershipId, businessMembershipId, "2026-07-13T12:00:00.123200Z"],
        [jobIds[3], 4, "finished", "Finished fixture", null, managerMembershipId, "2026-07-13T12:00:00.122900Z"],
        [jobIds[4], 5, "denied", "Denied fixture", managerMembershipId, managerMembershipId, "2026-07-13T12:00:00.122800Z"],
      ] as const;
      for (const job of seededJobs) {
        await admin.query(
          `INSERT INTO public.jobs (
             id, company_id, job_no, status, title, description,
             assigned_membership_id, created_by_membership_id,
             assigned_member_name_snapshot, created_by_name_snapshot,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'Live jobs-read fixture', $6, $7,
             'Assigned member', 'Creator member', $8::timestamptz, $8::timestamptz)`,
          [job[0], companyId, job[1], job[2], job[3], job[4], job[5], job[6]],
        );
      }
      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title, created_by_membership_id
         ) VALUES ($1, $2, 1, 'pending', 'Other tenant job', $3)`,
        [jobIds[5], otherCompanyId, otherManagerMembershipId],
      );

      const usersByToken = new Map([
        ["manager.payload.signature", managerUid],
        ["worker.payload.signature", workerUid],
        ["business.payload.signature", businessUid],
        ["basic.payload.signature", basicUid],
      ]);
      const verifier: FirebaseTokenVerifier = {
        issuer: "http://127.0.0.1:55321/auth/v1",
        audiences: ["authenticated"],
        async verifyAuthorizationHeader() {
          throw new Error("not used");
        },
        async verifyAccessToken(token) {
          const userId = usersByToken.get(token);
          assert.ok(userId, `unexpected integration token: ${token}`);
          return { userId, expiresAt: 4_102_444_800 };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerJobsReadRoutes(app, {
        database: contextualRuntime(admin),
        authenticator: createApiRequestAuthenticator({
          jwtVerifier: verifier,
          webSessions: {
            async authenticateSession() {
              throw new Error("not used");
            },
          },
        }),
      });

      const request = (token: string, url: string) => app?.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      const firstPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs?pageSize=2`,
      );
      assert.ok(firstPage);
      assert.equal(firstPage.statusCode, 200, firstPage.body);
      assert.deepEqual(
        firstPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        [jobIds[0], jobIds[1]],
      );
      assert.equal(firstPage.json().data.items[0]?.entityVersion, "ev1.MQ");
      const cursor = String(firstPage.json().data.nextCursor);

      await admin.query(
        `INSERT INTO public.jobs (
           id, company_id, job_no, status, title,
           assigned_membership_id, created_by_membership_id, created_at, updated_at
         ) VALUES ($1, $2, 6, 'pending', 'Newest concurrent insert', $3, $3,
           '2026-07-13T13:00:00.000Z', '2026-07-13T13:00:00.000Z')`,
        [jobIds[6], companyId, managerMembershipId],
      );
      const secondPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs?pageSize=2&afterCursor=${encodeURIComponent(cursor)}`,
      );
      assert.ok(secondPage);
      assert.equal(secondPage.statusCode, 200, secondPage.body);
      assert.deepEqual(
        secondPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        [jobIds[2], jobIds[3]],
      );
      const traversedJobIds = [
        ...firstPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        ...secondPage.json().data.items.map((job: { jobId: string }) => job.jobId),
      ];
      assert.deepEqual(traversedJobIds, jobIds.slice(0, 4));
      assert.equal(new Set(traversedJobIds).size, traversedJobIds.length);
      assert.equal(
        secondPage.json().data.items.some((job: { jobId: string }) => job.jobId === jobIds[6]),
        false,
      );

      const workerPage = await request(
        "worker.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs?limit=200`,
      );
      assert.ok(workerPage);
      assert.equal(workerPage.statusCode, 200, workerPage.body);
      assert.deepEqual(
        workerPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        [jobIds[0], jobIds[2]],
      );

      const businessPage = await request(
        "business.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs`,
      );
      assert.ok(businessPage);
      assert.equal(businessPage.statusCode, 200, businessPage.body);
      assert.deepEqual(
        businessPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        [jobIds[1]],
      );

      const basicPage = await request(
        "basic.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs`,
      );
      assert.ok(basicPage);
      assert.equal(basicPage.statusCode, 200, basicPage.body);
      assert.deepEqual(basicPage.json().data.items, []);

      const filteredPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs`
          + `?status=pending&creatorUid=${managerUid}&search=Pump`
          + "&dateFrom=2026-07-13T10%3A30%3A00.000Z"
          + "&dateTo=2026-07-13T12%3A30%3A00.000Z",
      );
      assert.ok(filteredPage);
      assert.equal(filteredPage.statusCode, 200, filteredPage.body);
      assert.deepEqual(
        filteredPage.json().data.items.map((job: { jobId: string }) => job.jobId),
        [jobIds[0], jobIds[1]],
      );

      const forgedTenant = await request(
        "manager.payload.signature",
        `/api/v1/companies/${otherPublicCompanyId}/jobs`,
      );
      assert.ok(forgedTenant);
      assert.equal(forgedTenant.statusCode, 404, forgedTenant.body);
      assert.equal(forgedTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{solojob}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const disabledModule = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/jobs`,
      );
      assert.ok(disabledModule);
      assert.equal(disabledModule.statusCode, 403, disabledModule.body);
      assert.equal(disabledModule.json().error.code, "JOBS_MODULE_DISABLED");
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = ANY($1::uuid[])", [
        [companyId, otherCompanyId],
      ]).catch(() => undefined);
      await admin.query("DELETE FROM public.app_users WHERE id = ANY($1::text[])", [userIds])
        .catch(() => undefined);
      await admin.end();
    }
  });
}
