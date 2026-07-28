import test from "node:test";
import assert from "node:assert/strict";
import {
  ClientListQuerySchema,
  CursorSchema,
} from "@smart-job/api-contracts";
import {
  WEBSITE_CLIENTS_PAGE_SIZE,
  buildClientsPageHref,
  buildCompanyClientsApiPath,
  hasActiveClientsFilters,
  parseClientsSearchParams,
} from "../src/lib/dal/clients-query.ts";

test("client URL state becomes one bounded API query", () => {
  const cursor = CursorSchema.parse("opaque-next-cursor");
  const result = parseClientsSearchParams({
    search: "  Northwind  ",
    afterCursor: cursor,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.filters, { search: "Northwind" });
  assert.deepEqual(result.query, {
    search: "Northwind",
    afterCursor: cursor,
    pageSize: WEBSITE_CLIENTS_PAGE_SIZE,
  });
  assert.equal(result.afterCursor, cursor);
});

test("client search parsing rejects duplicate and oversized values", () => {
  assert.equal(parseClientsSearchParams({ search: ["first", "second"] }).ok, false);
  assert.equal(parseClientsSearchParams({ afterCursor: ["first", "second"] }).ok, false);
  assert.equal(parseClientsSearchParams({ search: "x".repeat(81) }).ok, false);

  const empty = parseClientsSearchParams({ search: "   " });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.deepEqual(empty.query, { pageSize: WEBSITE_CLIENTS_PAGE_SIZE });
  assert.equal(hasActiveClientsFilters(empty.filters), false);
});

test("clients backend path transports search, page size, and opaque cursor", () => {
  const query = ClientListQuerySchema.parse({
    search: "heat pump",
    pageSize: 25,
    afterCursor: "opaque+/cursor=",
  });
  const path = buildCompanyClientsApiPath(42, query);
  const url = new URL(path, "https://api.example.test");

  assert.equal(url.pathname, "/api/v1/companies/42/clients");
  assert.equal(url.searchParams.get("search"), "heat pump");
  assert.equal(url.searchParams.get("pageSize"), "25");
  assert.equal(url.searchParams.get("afterCursor"), "opaque+/cursor=");
});

test("client pagination links preserve public search without credentials", () => {
  const href = buildClientsPageHref(
    42,
    { search: "annual service" },
    CursorSchema.parse("opaque-cursor"),
  );
  const url = new URL(href, "https://website.example.test");

  assert.equal(url.pathname, "/app/c/42/clients");
  assert.equal(url.searchParams.get("search"), "annual service");
  assert.equal(url.searchParams.get("afterCursor"), "opaque-cursor");
  assert.doesNotMatch(href, /token|authorization|session/i);
});
