import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Client, type QueryResultRow } from "pg";

import type { ApiRequestAuthenticator } from "../auth/index.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ApiDatabaseRuntime, DatabaseQueryable } from "../database/runtime.js";
import { registerInventoryMutationRoutes } from "../routes/inventory-mutations.js";

const adminDatabaseUrl = String(process.env.SMART_JOB_TEST_ADMIN_DATABASE_URL ?? "").trim();

function assertLoopbackDatabase(value: string): URL {
  const url = new URL(value);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase()),
    "The inventory-mutation integration test only runs against a loopback database",
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

async function concurrentAdjustment(
  databaseUrl: URL,
  userId: string,
  companyId: string,
  partId: string,
  expectedVersion: number,
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
    const result = await client.query(
      `SELECT * FROM private.adjust_api_inventory_stock(
         $1::uuid, $2::uuid, 'company', $3::bigint, -1, NULL, clock_timestamp()
       )`,
      [companyId, partId, expectedVersion],
    );
    await client.query("COMMIT");
    return result.rows[0] as { quantity_on_hand: string; stock_entity_version: string };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (adminDatabaseUrl.length === 0) {
  test("inventory mutations enforce tenancy, roles, concurrency, stock, picks, and replay", {
    skip: "SMART_JOB_TEST_ADMIN_DATABASE_URL is required for local inventory-mutation integration",
  }, () => undefined);
} else {
  test("inventory mutations enforce tenancy, roles, concurrency, stock, picks, and replay", {
    timeout: 60_000,
  }, async () => {
    const databaseUrl = assertLoopbackDatabase(adminDatabaseUrl);
    const admin = new Client({ connectionString: databaseUrl.href, ssl: false });
    const managerId = randomUUID();
    const workerId = randomUUID();
    const otherManagerId = randomUUID();
    const userIds = [managerId, workerId, otherManagerId];
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const companyIds = [companyId, otherCompanyId];
    const memberships = Array.from({ length: 3 }, () => randomUUID());
    const publicCompanyId = 8_500_000_000_000 + randomInt(500_000);
    const otherPublicCompanyId = publicCompanyId + 1;
    let activeUserId = managerId;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    await admin.connect();
    try {
      for (const [index, userId] of userIds.entries()) {
        await admin.query(
          "INSERT INTO public.app_users (id, email, display_name) VALUES ($1, $2, $3)",
          [userId, `inventory-${userId}@example.invalid`, `Inventory user ${index + 1}`],
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
        "INSERT INTO public.company_profiles (company_id, he_name) VALUES ($1, 'Inventory'), ($2, 'Other Inventory')",
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_subscriptions (company_id, tier, status, enabled_modules)
         VALUES
           ($1, 'Team', 'active', '{"inventory":true}'::jsonb),
           ($2, 'Team', 'active', '{"inventory":true}'::jsonb)`,
        [companyId, otherCompanyId],
      );
      await admin.query(
        `INSERT INTO public.company_memberships (
           id, company_id, user_id, member_no, role, status, display_name
         ) VALUES
           ($1, $2, $3, 1, 'manager', 'active', 'Inventory manager'),
           ($4, $2, $5, 2, 'worker', 'active', 'Inventory worker'),
           ($6, $7, $8, 1, 'manager', 'active', 'Other manager')`,
        [
          memberships[0], companyId, managerId,
          memberships[1], workerId,
          memberships[2], otherCompanyId, otherManagerId,
        ],
      );

      const authenticator: ApiRequestAuthenticator = {
        async authenticate() {
          return {
            scheme: "bearer",
            userId: activeUserId,
            expiresAt: 4_102_444_800,
            accessToken: "inventory-integration.payload.signature",
          };
        },
      };
      app = await buildApp({ config: loadConfig({}), logger: false });
      registerInventoryMutationRoutes(app, {
        authenticator,
        database: contextualRuntime(admin),
        firebaseUsers: {
          async getUser() {
            return {
              userId: activeUserId,
              email: `inventory-${activeUserId}@example.invalid`,
              emailVerified: true,
            };
          },
        },
      });

      const createRequest = {
        method: "POST" as const,
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts`,
        headers: { "idempotency-key": "inventory-live-create" },
        payload: { name: "Relay", initialQuantity: 10, lowThreshold: 2, unit: "piece" },
      };
      const created = await app.inject(createRequest);
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().data.quantity, 10);
      assert.equal(created.json().data.entityVersion, "ev1.MQ");
      assert.equal(created.json().data.stockEntityVersion, "ev1.Mg");
      const partId = String(created.json().data.partId);

      const replay = await app.inject(createRequest);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json().data, created.json().data);
      const count = await admin.query(
        "SELECT COUNT(*)::integer AS count FROM public.inventory_parts WHERE company_id = $1",
        [companyId],
      );
      assert.equal(count.rows[0].count, 1);

      const adjusted = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-adjust" },
        payload: { stockEntityVersion: "ev1.Mg", quantityDelta: -2 },
      });
      assert.equal(adjusted.statusCode, 200, adjusted.body);
      assert.equal(adjusted.json().data.quantity, 8);
      assert.equal(adjusted.json().data.stockEntityVersion, "ev1.Mw");

      const stale = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-adjust-stale" },
        payload: { stockEntityVersion: "ev1.Mg", quantityDelta: -1 },
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().error.code, "STALE_ENTITY_VERSION");

      const insufficient = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-adjust-insufficient" },
        payload: { stockEntityVersion: "ev1.Mw", quantityDelta: -9 },
      });
      assert.equal(insufficient.statusCode, 409, insufficient.body);
      assert.equal(insufficient.json().error.code, "INSUFFICIENT_STOCK");

      activeUserId = workerId;
      const workerForbidden = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-worker-company" },
        payload: { stockEntityVersion: "ev1.Mw", quantityDelta: 1 },
      });
      assert.equal(workerForbidden.statusCode, 403, workerForbidden.body);
      const workerSelf = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/me/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-worker-self" },
        payload: { stockEntityVersion: "ev1.MQ", quantityDelta: 3 },
      });
      assert.equal(workerSelf.statusCode, 200, workerSelf.body);
      assert.equal(workerSelf.json().data.quantity, 3);

      activeUserId = managerId;
      const crossTenant = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${otherPublicCompanyId}/inventory/parts`,
        headers: { "idempotency-key": "inventory-live-cross-tenant" },
        payload: { name: "Forged part" },
      });
      assert.ok([403, 404].includes(crossTenant.statusCode), crossTenant.body);

      const transfer = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/transfers`,
        headers: { "idempotency-key": "inventory-live-transfer" },
        payload: {
          partId,
          memberNo: 2,
          direction: "company_to_member",
          quantity: 2,
          sourceStockEntityVersion: "ev1.Mw",
        },
      });
      assert.equal(transfer.statusCode, 200, transfer.body);
      assert.equal(transfer.json().data.movement.sourceQuantity, 6);

      const pick = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/picks`,
        headers: { "idempotency-key": "inventory-live-pick" },
        payload: {
          memberNo: 2,
          items: [{ partId, quantity: 2, stockEntityVersion: "ev1.NA" }],
        },
      });
      assert.equal(pick.statusCode, 200, pick.body);
      assert.equal(pick.json().data.movements[0].sourceQuantity, 4);

      const beforeConcurrent = await admin.query(
        `SELECT balance.entity_version::integer AS version
         FROM public.inventory_balances AS balance
         INNER JOIN public.inventory_locations AS location ON location.id = balance.location_id
         WHERE location.company_id = $1 AND location.location_type = 'company'
           AND balance.part_id = $2`,
        [companyId, partId],
      );
      const expectedVersion = Number(beforeConcurrent.rows[0].version);
      const concurrent = await Promise.allSettled([
        concurrentAdjustment(databaseUrl, managerId, companyId, partId, expectedVersion),
        concurrentAdjustment(databaseUrl, managerId, companyId, partId, expectedVersion),
      ]);
      assert.equal(concurrent.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const rejected = concurrent.find((outcome) => outcome.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.equal((rejected.reason as { code?: string }).code, "40001");

      const archiveWithStock = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}`,
        headers: { "idempotency-key": "inventory-live-archive-stock" },
        payload: { entityVersion: "ev1.MQ" },
      });
      assert.equal(archiveWithStock.statusCode, 409, archiveWithStock.body);

      const returnedAllMemberStock = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/transfers`,
        headers: { "idempotency-key": "inventory-live-return-all" },
        payload: {
          partId,
          memberNo: 2,
          direction: "member_to_company",
          quantity: 7,
          sourceStockEntityVersion: "ev1.NA",
        },
      });
      assert.equal(returnedAllMemberStock.statusCode, 200, returnedAllMemberStock.body);
      assert.equal(returnedAllMemberStock.json().data.movement.sourceQuantity, 0);
      assert.equal(returnedAllMemberStock.json().data.movement.destinationQuantity, 10);

      const adjustedCompanyToZero = await app.inject({
        method: "POST",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}/adjustments`,
        headers: { "idempotency-key": "inventory-live-adjust-zero" },
        payload: { stockEntityVersion: "ev1.Nw", quantityDelta: -10 },
      });
      assert.equal(adjustedCompanyToZero.statusCode, 200, adjustedCompanyToZero.body);
      assert.equal(adjustedCompanyToZero.json().data.quantity, 0);

      const archived = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${publicCompanyId}/inventory/parts/${partId}`,
        headers: { "idempotency-key": "inventory-live-archive-zero" },
        payload: { entityVersion: "ev1.MQ" },
      });
      assert.equal(archived.statusCode, 200, archived.body);
      assert.equal(archived.json().data.status, "archived");
      assert.equal(archived.json().data.entityVersion, "ev1.Mg");

      const sync = await admin.query(
        "SELECT company_inventory_version FROM public.company_sync_state WHERE company_id = $1",
        [companyId],
      );
      assert.ok(Number(sync.rows[0].company_inventory_version) >= 6);
      const mismatchedMovements = await admin.query(
        `SELECT COUNT(*)::integer AS count
         FROM public.inventory_movements AS movement
         LEFT JOIN public.inventory_parts AS part ON part.id = movement.part_id
         WHERE movement.company_id = $1 AND part.company_id IS DISTINCT FROM movement.company_id`,
        [companyId],
      );
      assert.equal(mismatchedMovements.rows[0].count, 0);
    } finally {
      await app?.close().catch(() => undefined);
      await admin.query("DELETE FROM public.companies WHERE id = ANY($1::uuid[])", [companyIds]).catch(() => undefined);
      await admin.query("DELETE FROM public.app_users WHERE id = ANY($1::text[])", [userIds]).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });
}
