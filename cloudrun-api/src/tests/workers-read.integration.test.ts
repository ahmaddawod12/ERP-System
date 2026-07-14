import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import { createApiRequestAuthenticator, type SupabaseJwtVerifier } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type {
  ApiDatabaseRuntime,
  DatabaseQueryable,
} from "../database/runtime.js";
import { registerWorkersReadRoutes } from "../routes/workers-read.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The workers-read integration test only runs against a loopback database",
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
  test("worker reads enforce live tenant, role, entitlement, filters, and microsecond cursor behavior", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local workers-read integration",
  }, () => undefined);
} else {
  test("worker reads enforce live tenant, role, entitlement, filters, and microsecond cursor behavior", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerUid = randomUUID();
    const workerUid = randomUUID();
    const businessUid = randomUUID();
    const basicUid = randomUUID();
    const disabledUid = randomUUID();
    const pendingUid = randomUUID();
    const otherManagerUid = randomUUID();
    const devUid = randomUUID();
    const userIds = [
      managerUid,
      workerUid,
      businessUid,
      basicUid,
      disabledUid,
      pendingUid,
      otherManagerUid,
      devUid,
    ];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const publicCompanyId = 8_400_000_000 + randomInt(1_000_000);
    const otherPublicCompanyId = 8_500_000_000 + randomInt(1_000_000);
    const precisionMembershipIds = Array.from({ length: 2 }, () => randomUUID()).sort().reverse();
    const membershipIds = [
      randomUUID(),
      precisionMembershipIds[0]!,
      precisionMembershipIds[1]!,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ] as const;
    const concurrentMembershipId = randomUUID();
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, scopedUserId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name, system_role)
           VALUES ($1, $2, $3, $4)`,
          [
            scopedUserId,
            `workers-read-${scopedUserId}@example.invalid`,
            `Worker read user ${index + 1}`,
            scopedUserId === devUid ? "dev" : null,
          ],
        );
      }
      await admin.query(
        `INSERT INTO public.companies (
           id, public_company_id, account_type, status, created_by_user_id
         ) VALUES
           ($1, $2, 'business', 'active', $3),
           ($4, $5, 'business', 'active', $6)`,
        [companyId, publicCompanyId, managerUid, otherCompanyId, otherPublicCompanyId, otherManagerUid],
      );
      await admin.query(
        `INSERT INTO public.company_profiles (company_id, he_name)
         VALUES ($1, 'Workers Read Workspace'), ($2, 'Other Workers Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, enabled_modules)
         VALUES
           ($1, 'Team', '{"team":true}'::jsonb),
           ($2, 'Team', '{"team":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      const memberships = [
        [membershipIds[0], companyId, managerUid, 1, "manager", "active", "Team manager", "2026-07-13T07:00:00.000Z"],
        [membershipIds[1], companyId, workerUid, 2, "worker", "active", "Alpha Technician", "2026-07-13T12:00:00.123456Z"],
        [membershipIds[2], companyId, businessUid, 3, "user", "active", "Business User", "2026-07-13T12:00:00.123456Z"],
        [membershipIds[3], companyId, basicUid, 4, "basic", "active", "Basic User", "2026-07-13T12:00:00.123200Z"],
        [membershipIds[4], companyId, disabledUid, 5, "worker", "disabled", "Disabled Technician", "2026-07-13T12:00:00.122900Z"],
        [membershipIds[5], companyId, pendingUid, 6, "user", "pending", "Pending User", "2026-07-13T12:00:00.122800Z"],
        [membershipIds[6], otherCompanyId, otherManagerUid, 1, "manager", "active", "Other manager", "2026-07-13T07:00:00.000Z"],
      ] as const;
      for (const membership of memberships) {
        await admin.query(
          `INSERT INTO public.company_memberships (
             id, company_id, user_id, member_no, role, status, display_name,
             phone_number, joined_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, '+972500000000',
             $8::timestamptz, $8::timestamptz, $8::timestamptz
           )`,
          [...membership],
        );
      }

      const usersByToken = new Map([
        ["manager.payload.signature", managerUid],
        ["worker.payload.signature", workerUid],
        ["dev.payload.signature", devUid],
      ]);
      const verifier: SupabaseJwtVerifier = {
        issuer: "http://127.0.0.1:55321/auth/v1",
        audiences: ["authenticated"],
        async verifyAuthorizationHeader() {
          throw new Error("not used");
        },
        async verifyAccessToken(token) {
          const scopedUserId = usersByToken.get(token);
          assert.ok(scopedUserId, `unexpected integration token: ${token}`);
          return { userId: scopedUserId, expiresAt: 4_102_444_800 };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerWorkersReadRoutes(app, {
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
        `/api/v1/companies/${publicCompanyId}/workers?pageSize=2`,
      );
      assert.ok(firstPage);
      assert.equal(firstPage.statusCode, 200, firstPage.body);
      assert.deepEqual(
        firstPage.json().data.items.map((worker: { memberNo: number }) => worker.memberNo),
        [2, 3],
      );
      assert.equal("membershipId" in firstPage.json().data.items[0], false);
      assert.equal(firstPage.json().data.items[0]?.email, null);
      const cursor = String(firstPage.json().data.nextCursor);

      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name,
           joined_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 7, 'worker', 'active', 'Newest concurrent technician',
           '2026-07-13T13:00:00.000Z', '2026-07-13T13:00:00.000Z', '2026-07-13T13:00:00.000Z'
         )`,
        [concurrentMembershipId, companyId, devUid],
      );
      const secondPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/workers?pageSize=2&afterCursor=${encodeURIComponent(cursor)}`,
      );
      assert.ok(secondPage);
      assert.equal(secondPage.statusCode, 200, secondPage.body);
      assert.deepEqual(
        secondPage.json().data.items.map((worker: { memberNo: number }) => worker.memberNo),
        [4, 5],
      );
      const traversedMemberNumbers = [
        ...firstPage.json().data.items.map((worker: { memberNo: number }) => worker.memberNo),
        ...secondPage.json().data.items.map((worker: { memberNo: number }) => worker.memberNo),
      ];
      assert.deepEqual(traversedMemberNumbers, [2, 3, 4, 5]);
      assert.equal(new Set(traversedMemberNumbers).size, traversedMemberNumbers.length);
      assert.equal(
        secondPage.json().data.items.some(
          (worker: { memberNo: number }) => worker.memberNo === 7,
        ),
        false,
      );

      const filtered = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/workers?role=worker&status=disabled&search=disabled`,
      );
      assert.ok(filtered);
      assert.equal(filtered.statusCode, 200, filtered.body);
      assert.deepEqual(
        filtered.json().data.items.map((worker: { memberNo: number }) => worker.memberNo),
        [5],
      );

      const wrongRole = await request(
        "worker.payload.signature",
        `/api/v1/companies/${publicCompanyId}/workers`,
      );
      assert.ok(wrongRole);
      assert.equal(wrongRole.statusCode, 403, wrongRole.body);
      assert.equal(wrongRole.json().error.code, "WORKERS_ACCESS_FORBIDDEN");

      const forgedTenant = await request(
        "manager.payload.signature",
        `/api/v1/companies/${otherPublicCompanyId}/workers`,
      );
      assert.ok(forgedTenant);
      assert.equal(forgedTenant.statusCode, 404, forgedTenant.body);
      assert.equal(forgedTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{team}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const disabledModule = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/workers`,
      );
      assert.ok(disabledModule);
      assert.equal(disabledModule.statusCode, 403, disabledModule.body);
      assert.equal(disabledModule.json().error.code, "WORKERS_MODULE_DISABLED");

      const devPage = await request(
        "dev.payload.signature",
        `/api/v1/companies/${publicCompanyId}/workers?pageSize=200`,
      );
      assert.ok(devPage);
      assert.equal(devPage.statusCode, 200, devPage.body);
      assert.equal(devPage.json().data.items.length, 6);
      assert.equal(typeof devPage.json().data.items[0]?.email, "string");
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
