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
import { registerClientsReadRoutes } from "../routes/clients-read.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The clients-read integration test only runs against a loopback database",
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
  test("client reads enforce live tenant, role, entitlement, search, and microsecond cursor behavior", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local clients-read integration",
  }, () => undefined);
} else {
  test("client reads enforce live tenant, role, entitlement, search, and microsecond cursor behavior", {
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
    const publicCompanyId = 8_200_000_000 + randomInt(1_000_000);
    const otherPublicCompanyId = 8_300_000_000 + randomInt(1_000_000);
    const membershipIds = Array.from({ length: 5 }, () => randomUUID());
    const precisionClientIds = Array.from({ length: 2 }, () => randomUUID()).sort().reverse();
    const clientIds = [
      precisionClientIds[0]!,
      precisionClientIds[1]!,
      ...Array.from({ length: 5 }, () => randomUUID()),
    ];
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name)
           VALUES ($1, $2, $3)`,
          [userId, `clients-read-${userId}@example.invalid`, `Client read user ${index + 1}`],
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
         VALUES ($1, 'Clients Read Workspace'), ($2, 'Other Clients Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, enabled_modules)
         VALUES
           ($1, 'Team', '{"clients":true}'::jsonb),
           ($2, 'Team', '{"clients":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Client manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Client worker'),
           ($6, $2, $7, 3, 'user', 'active', 'Client business user'),
           ($8, $2, $9, 4, 'basic', 'active', 'Client basic user'),
           ($10, $11, $12, 1, 'manager', 'active', 'Other client manager')`,
        [
          membershipIds[0], companyId, managerUid,
          membershipIds[1], workerUid,
          membershipIds[2], businessUid,
          membershipIds[3], basicUid,
          membershipIds[4], otherCompanyId, otherManagerUid,
        ],
      );

      const seededClients = [
        [clientIds[0], 1, "active", "Northwind Alpha", "+97235550101", "2026-07-13T12:00:00.123456Z"],
        [clientIds[1], 2, "active", "Northwind Beta", "+97235550102", "2026-07-13T12:00:00.123456Z"],
        [clientIds[2], 3, "archived", "Archived Service", "+97235550103", "2026-07-13T12:00:00.123200Z"],
        [clientIds[3], 4, "active", "Compressor Customer", "+97235550104", "2026-07-13T12:00:00.122900Z"],
        [clientIds[4], 5, "active", "Ventilation Customer", "+97235550105", "2026-07-13T12:00:00.122800Z"],
      ] as const;
      for (const seededClient of seededClients) {
        await admin.query(
          `INSERT INTO public.clients (
             id, company_id, client_no, status, name, phone, email, city,
             vat_number, created_by_membership_id, created_at, updated_at, archived_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'Haifa', '515987654', $8,
             $9::timestamptz, $9::timestamptz,
             CASE WHEN $4::public.client_status = 'archived' THEN $9::timestamptz ELSE NULL END
           )`,
          [
            seededClient[0], companyId, seededClient[1], seededClient[2],
            seededClient[3], seededClient[4],
            `${seededClient[1]}@client.example`, membershipIds[0], seededClient[5],
          ],
        );
      }
      await admin.query(
        `INSERT INTO public.clients (
           id, company_id, client_no, status, name, created_by_membership_id
         ) VALUES ($1, $2, 1, 'active', 'Other tenant client', $3)`,
        [clientIds[5], otherCompanyId, membershipIds[4]],
      );

      const usersByToken = new Map([
        ["manager.payload.signature", managerUid],
        ["worker.payload.signature", workerUid],
        ["business.payload.signature", businessUid],
        ["basic.payload.signature", basicUid],
      ]);
      const verifier: SupabaseJwtVerifier = {
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
      registerClientsReadRoutes(app, {
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
        `/api/v1/companies/${publicCompanyId}/clients?pageSize=2`,
      );
      assert.ok(firstPage);
      assert.equal(firstPage.statusCode, 200, firstPage.body);
      assert.deepEqual(
        firstPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        [clientIds[0], clientIds[1]],
      );
      const cursor = String(firstPage.json().data.nextCursor);

      await admin.query(
        `INSERT INTO public.clients (
           id, company_id, client_no, status, name, created_by_membership_id,
           created_at, updated_at
         ) VALUES ($1, $2, 6, 'active', 'Newest concurrent client', $3,
           '2026-07-13T13:00:00.000Z', '2026-07-13T13:00:00.000Z')`,
        [clientIds[6], companyId, membershipIds[0]],
      );
      const secondPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/clients?pageSize=2&afterCursor=${encodeURIComponent(cursor)}`,
      );
      assert.ok(secondPage);
      assert.equal(secondPage.statusCode, 200, secondPage.body);
      assert.deepEqual(
        secondPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        [clientIds[3], clientIds[4]],
      );
      const traversedClientIds = [
        ...firstPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        ...secondPage.json().data.items.map((client: { clientId: string }) => client.clientId),
      ];
      assert.deepEqual(traversedClientIds, [
        clientIds[0],
        clientIds[1],
        clientIds[3],
        clientIds[4],
      ]);
      assert.equal(new Set(traversedClientIds).size, traversedClientIds.length);
      assert.equal(
        secondPage.json().data.items.some((client: { clientId: string }) => client.clientId === clientIds[6]),
        false,
      );
      assert.equal(secondPage.json().data.items[0]?.status, "active");

      const archivedPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/clients?status=archived`,
      );
      assert.ok(archivedPage);
      assert.equal(archivedPage.statusCode, 200, archivedPage.body);
      assert.deepEqual(
        archivedPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        [clientIds[2]],
      );

      for (const roleToken of [
        "worker.payload.signature",
        "business.payload.signature",
        "basic.payload.signature",
      ]) {
        const rolePage = await request(
          roleToken,
          `/api/v1/companies/${publicCompanyId}/clients?pageSize=200`,
        );
        assert.ok(rolePage);
        assert.equal(rolePage.statusCode, 200, rolePage.body);
        assert.equal(rolePage.json().data.items.length, 5);
        assert.equal(
          rolePage.json().data.items.some((client: { clientId: string }) => client.clientId === clientIds[5]),
          false,
        );
      }

      const searchPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/clients?search=north`,
      );
      assert.ok(searchPage);
      assert.equal(searchPage.statusCode, 200, searchPage.body);
      assert.deepEqual(
        searchPage.json().data.items.map((client: { clientId: string }) => client.clientId),
        [clientIds[0], clientIds[1]],
      );

      const forgedTenant = await request(
        "manager.payload.signature",
        `/api/v1/companies/${otherPublicCompanyId}/clients`,
      );
      assert.ok(forgedTenant);
      assert.equal(forgedTenant.statusCode, 404, forgedTenant.body);
      assert.equal(forgedTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{clients}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const disabledModule = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/clients`,
      );
      assert.ok(disabledModule);
      assert.equal(disabledModule.statusCode, 403, disabledModule.body);
      assert.equal(disabledModule.json().error.code, "CLIENTS_MODULE_DISABLED");
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
