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
import { registerInventoryReadRoutes } from "../routes/inventory-read.js";

const adminDatabaseUrl = String(
  process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "",
).trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The inventory-read integration test only runs against a loopback database",
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
  test("inventory reads enforce live tenant, role, member, filters, and microsecond cursor behavior", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local inventory-read integration",
  }, () => undefined);
} else {
  test("inventory reads enforce live tenant, role, member, filters, and microsecond cursor behavior", {
    timeout: 30_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerUid = randomUUID();
    const workerUid = randomUUID();
    const businessUid = randomUUID();
    const basicUid = randomUUID();
    const otherManagerUid = randomUUID();
    const devUid = randomUUID();
    const userIds = [managerUid, workerUid, businessUid, basicUid, otherManagerUid, devUid];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const publicCompanyId = 8_400_000_000 + randomInt(1_000_000);
    const otherPublicCompanyId = 8_500_000_000 + randomInt(1_000_000);
    const membershipIds = Array.from({ length: 5 }, () => randomUUID());
    const locationIds = Array.from({ length: 6 }, () => randomUUID());
    const precisionPartIds = Array.from({ length: 2 }, () => randomUUID()).sort().reverse();
    const partIds = [
      precisionPartIds[0]!,
      precisionPartIds[1]!,
      ...Array.from({ length: 5 }, () => randomUUID()),
    ];
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          `INSERT INTO public.app_users (id, email, display_name, system_role)
           VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN 'dev'::public.system_role ELSE NULL END)`,
          [
            userId,
            `inventory-read-${userId}@example.invalid`,
            `Inventory read user ${index + 1}`,
            userId === devUid,
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
         VALUES ($1, 'Inventory Read Workspace'), ($2, 'Other Inventory Workspace')`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, enabled_modules)
         VALUES
           ($1, 'Team', '{"inventory":true}'::jsonb),
           ($2, 'Team', '{"inventory":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Inventory manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Inventory worker'),
           ($6, $2, $7, 3, 'user', 'active', 'Inventory business user'),
           ($8, $2, $9, 4, 'basic', 'active', 'Inventory basic user'),
           ($10, $11, $12, 1, 'manager', 'active', 'Other inventory manager')`,
        [
          membershipIds[0], companyId, managerUid,
          membershipIds[1], workerUid,
          membershipIds[2], businessUid,
          membershipIds[3], basicUid,
          membershipIds[4], otherCompanyId, otherManagerUid,
        ],
      );
      await admin.query(
        `INSERT INTO public.inventory_locations (
           id, company_id, location_type, membership_id, name
         ) VALUES
           ($1, $2, 'company', NULL, 'Company Inventory'),
           ($3, $2, 'member', $4, 'Manager Inventory'),
           ($5, $2, 'member', $6, 'Worker Inventory'),
           ($7, $2, 'member', $8, 'Business User Inventory'),
           ($9, $2, 'member', $10, 'Basic User Inventory'),
           ($11, $12, 'company', NULL, 'Other Company Inventory')`,
        [
          locationIds[0], companyId,
          locationIds[1], membershipIds[0],
          locationIds[2], membershipIds[1],
          locationIds[3], membershipIds[2],
          locationIds[4], membershipIds[3],
          locationIds[5], otherCompanyId,
        ],
      );

      const seededParts = [
        [partIds[0], companyId, 1001, "Compressor Alpha", true, null, "2026-07-13T12:00:00.123456Z"],
        [partIds[1], companyId, 1002, "Compressor Beta", true, null, "2026-07-13T12:00:00.123456Z"],
        [partIds[2], companyId, 2001, "Inactive Belt", false, null, "2026-07-13T12:00:00.123200Z"],
        [partIds[3], companyId, 3001, "Archived Pump", false, "2026-07-13T12:00:00.123150Z", "2026-07-13T12:00:00.123150Z"],
        [partIds[4], companyId, 4001, "Ventilation Filter", true, null, "2026-07-13T12:00:00.123100Z"],
        [partIds[5], otherCompanyId, 1001, "Other Tenant Part", true, null, "2026-07-13T12:00:00.000Z"],
      ] as const;
      for (const part of seededParts) {
        await admin.query(
          `INSERT INTO public.inventory_parts (
             id, company_id, part_no, name, active, low_threshold, unit,
             created_at, updated_at, archived_at
           ) VALUES ($1, $2, $3, $4, $5, 3.000, 'piece', $7::timestamptz,
             $7::timestamptz, $6::timestamptz)`,
          [...part],
        );
      }

      const balances = [
        [locationIds[0], partIds[0], 50],
        [locationIds[0], partIds[1], 40],
        [locationIds[0], partIds[2], 30],
        [locationIds[0], partIds[3], 20],
        [locationIds[1], partIds[1], 3],
        [locationIds[2], partIds[0], 7],
        [locationIds[2], partIds[2], 2],
        [locationIds[3], partIds[4], 5],
        [locationIds[4], partIds[0], 99],
        [locationIds[5], partIds[5], 77],
      ] as const;
      for (const [locationId, partId, quantity] of balances) {
        await admin.query(
          `INSERT INTO public.inventory_balances (location_id, part_id, quantity_on_hand)
           VALUES ($1, $2, $3)`,
          [locationId, partId, quantity],
        );
      }

      const usersByToken = new Map([
        ["manager.payload.signature", managerUid],
        ["worker.payload.signature", workerUid],
        ["business.payload.signature", businessUid],
        ["basic.payload.signature", basicUid],
        ["dev.payload.signature", devUid],
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
      registerInventoryReadRoutes(app, {
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

      const request = (token: string, path: string) => app?.inject({
        method: "GET",
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });

      const firstPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory?pageSize=2`,
      );
      assert.ok(firstPage);
      assert.equal(firstPage.statusCode, 200, firstPage.body);
      assert.deepEqual(
        firstPage.json().data.items.map((part: { partId: string }) => part.partId),
        [partIds[0], partIds[1]],
      );
      assert.deepEqual(
        firstPage.json().data.items.map((part: { quantity: number }) => part.quantity),
        [50, 40],
      );
      const cursor = String(firstPage.json().data.nextCursor);

      await admin.query(
        `INSERT INTO public.inventory_parts (
           id, company_id, part_no, name, active, low_threshold, unit,
           created_at, updated_at
         ) VALUES ($1, $2, 5001, 'Newest Concurrent Part', true, 1, 'piece',
           '2026-07-13T13:00:00.000Z', '2026-07-13T13:00:00.000Z')`,
        [partIds[6], companyId],
      );
      await admin.query(
        `INSERT INTO public.inventory_balances (location_id, part_id, quantity_on_hand)
         VALUES ($1, $2, 60)`,
        [locationIds[0], partIds[6]],
      );

      const secondPage = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory?pageSize=2&afterCursor=${encodeURIComponent(cursor)}`,
      );
      assert.ok(secondPage);
      assert.equal(secondPage.statusCode, 200, secondPage.body);
      assert.deepEqual(
        secondPage.json().data.items.map((part: { partId: string }) => part.partId),
        [partIds[2], partIds[4]],
      );
      const traversedPartIds = [
        ...firstPage.json().data.items.map((part: { partId: string }) => part.partId),
        ...secondPage.json().data.items.map((part: { partId: string }) => part.partId),
      ];
      assert.deepEqual(traversedPartIds, [partIds[0], partIds[1], partIds[2], partIds[4]]);
      assert.equal(new Set(traversedPartIds).size, traversedPartIds.length);
      assert.deepEqual(
        secondPage.json().data.items.map((part: { quantity: number }) => part.quantity),
        [30, 0],
      );
      assert.equal(
        secondPage.json().data.items.some((part: { partId: string }) => part.partId === partIds[6]),
        false,
      );

      const companySearch = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory?search=pressor`,
      );
      assert.ok(companySearch);
      assert.equal(companySearch.statusCode, 200, companySearch.body);
      assert.deepEqual(
        companySearch.json().data.items.map((part: { partId: string }) => part.partId),
        [partIds[0], partIds[1]],
      );

      const partNumberSearch = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory?search=100`,
      );
      assert.ok(partNumberSearch);
      assert.equal(partNumberSearch.statusCode, 200, partNumberSearch.body);
      assert.deepEqual(
        partNumberSearch.json().data.items.map((part: { partNo: number }) => part.partNo),
        [1001, 1002],
      );

      const archived = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory?status=archived`,
      );
      assert.ok(archived);
      assert.equal(archived.statusCode, 200, archived.body);
      assert.deepEqual(
        archived.json().data.items.map((part: { partId: string }) => part.partId),
        [partIds[3]],
      );
      assert.equal(archived.json().data.items[0]?.status, "archived");

      for (const roleToken of ["manager.payload.signature", "business.payload.signature", "dev.payload.signature"]) {
        const companyPage = await request(
          roleToken,
          `/api/v1/companies/${publicCompanyId}/inventory?pageSize=200`,
        );
        assert.ok(companyPage);
        assert.equal(companyPage.statusCode, 200, companyPage.body);
        assert.equal(companyPage.json().data.items.length, 5);
        assert.equal(
          companyPage.json().data.items.some((part: { partId: string }) => part.partId === partIds[5]),
          false,
        );
      }

      for (const roleToken of ["worker.payload.signature", "basic.payload.signature"]) {
        const deniedCompanyPage = await request(
          roleToken,
          `/api/v1/companies/${publicCompanyId}/inventory`,
        );
        assert.ok(deniedCompanyPage);
        assert.equal(deniedCompanyPage.statusCode, 403, deniedCompanyPage.body);
      }

      const workerInventory = await request(
        "worker.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory/me?pageSize=200`,
      );
      assert.ok(workerInventory);
      assert.equal(workerInventory.statusCode, 200, workerInventory.body);
      assert.deepEqual(
        workerInventory.json().data.items.map((part: { partId: string; quantity: number }) => [part.partId, part.quantity]),
        [[partIds[0], 7], [partIds[2], 2]],
      );
      assert.equal(
        workerInventory.json().data.items.some((part: { quantity: number }) => part.quantity === 99),
        false,
      );

      const attemptedTargetOverride = await request(
        "worker.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory/me?targetUid=${managerUid}`,
      );
      assert.ok(attemptedTargetOverride);
      assert.equal(attemptedTargetOverride.statusCode, 400, attemptedTargetOverride.body);

      const basicMemberInventory = await request(
        "basic.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory/me`,
      );
      assert.ok(basicMemberInventory);
      assert.equal(basicMemberInventory.statusCode, 403, basicMemberInventory.body);
      assert.equal(basicMemberInventory.json().error.code, "MEMBER_INVENTORY_FORBIDDEN");

      const forgedTenant = await request(
        "manager.payload.signature",
        `/api/v1/companies/${otherPublicCompanyId}/inventory`,
      );
      assert.ok(forgedTenant);
      assert.equal(forgedTenant.statusCode, 404, forgedTenant.body);
      assert.equal(forgedTenant.json().error.code, "WORKSPACE_NOT_FOUND");

      await admin.query(
        `UPDATE public.company_subscriptions
         SET enabled_modules = jsonb_set(enabled_modules, '{inventory}', 'false'::jsonb)
         WHERE company_id = $1`,
        [companyId],
      );
      const disabledModule = await request(
        "manager.payload.signature",
        `/api/v1/companies/${publicCompanyId}/inventory`,
      );
      assert.ok(disabledModule);
      assert.equal(disabledModule.statusCode, 403, disabledModule.body);
      assert.equal(disabledModule.json().error.code, "INVENTORY_MODULE_DISABLED");
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
