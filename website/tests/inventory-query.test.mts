import test from "node:test";
import assert from "node:assert/strict";
import {
  CursorSchema,
  InventoryListQuerySchema,
} from "@smart-job/api-contracts";
import {
  WEBSITE_INVENTORY_PAGE_SIZE,
  buildCompanyInventoryApiPath,
  buildInventoryPageHref,
  hasActiveInventoryFilters,
  parseInventorySearchParams,
} from "../src/lib/dal/inventory-query.ts";

test("inventory URL state becomes one bounded API query", () => {
  const cursor = CursorSchema.parse("opaque-next-cursor");
  const result = parseInventorySearchParams({
    status: " ACTIVE ",
    search: "  compressor  ",
    afterCursor: cursor,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.filters, { status: "active", search: "compressor" });
  assert.deepEqual(result.query, {
    status: "active",
    search: "compressor",
    afterCursor: cursor,
    pageSize: WEBSITE_INVENTORY_PAGE_SIZE,
  });
  assert.equal(result.afterCursor, cursor);
});

test("inventory filter parsing rejects duplicates and invalid or oversized values", () => {
  assert.equal(parseInventorySearchParams({ status: ["active", "archived"] }).ok, false);
  assert.equal(parseInventorySearchParams({ search: ["first", "second"] }).ok, false);
  assert.equal(parseInventorySearchParams({ afterCursor: ["first", "second"] }).ok, false);
  assert.equal(parseInventorySearchParams({ status: "unknown" }).ok, false);
  assert.equal(parseInventorySearchParams({ search: "x".repeat(81) }).ok, false);

  const empty = parseInventorySearchParams({ search: "   ", status: "" });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.deepEqual(empty.query, { pageSize: WEBSITE_INVENTORY_PAGE_SIZE });
  assert.equal(hasActiveInventoryFilters(empty.filters), false);
});

test("inventory backend paths preserve scope, statuses, and opaque pagination", () => {
  const query = InventoryListQuerySchema.parse({
    status: ["active", "inactive"],
    search: "heat pump",
    pageSize: 25,
    afterCursor: "opaque+/cursor=",
  });
  const companyUrl = new URL(
    buildCompanyInventoryApiPath(42, "company", query),
    "https://api.example.test",
  );
  const memberUrl = new URL(
    buildCompanyInventoryApiPath(42, "member", query),
    "https://api.example.test",
  );

  assert.equal(companyUrl.pathname, "/api/v1/companies/42/inventory");
  assert.equal(memberUrl.pathname, "/api/v1/companies/42/inventory/me");
  assert.deepEqual(companyUrl.searchParams.getAll("status"), ["active", "inactive"]);
  assert.equal(companyUrl.searchParams.get("search"), "heat pump");
  assert.equal(companyUrl.searchParams.get("pageSize"), "25");
  assert.equal(companyUrl.searchParams.get("afterCursor"), "opaque+/cursor=");
});

test("inventory pagination links preserve public filters without credentials", () => {
  const href = buildInventoryPageHref(
    42,
    { status: "archived", search: "relay" },
    CursorSchema.parse("opaque-cursor"),
  );
  const url = new URL(href, "https://website.example.test");

  assert.equal(url.pathname, "/app/c/42/inventory");
  assert.equal(url.searchParams.get("status"), "archived");
  assert.equal(url.searchParams.get("search"), "relay");
  assert.equal(url.searchParams.get("afterCursor"), "opaque-cursor");
  assert.doesNotMatch(href, /token|authorization|session/i);
});
