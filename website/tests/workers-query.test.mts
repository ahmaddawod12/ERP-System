import assert from "node:assert/strict";
import test from "node:test";
import { CursorSchema } from "@smart-job/api-contracts";

import {
  buildCompanyWorkersApiPath,
  buildWorkersPageHref,
  hasActiveWorkersFilters,
  parseWorkersSearchParams,
  WEBSITE_WORKERS_PAGE_SIZE,
} from "../src/lib/dal/workers-query.ts";

test("worker search params produce one bounded canonical API query", () => {
  const parsed = parseWorkersSearchParams({
    search: "  technician  ",
    role: "worker",
    status: "active",
    afterCursor: "opaque-cursor",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.filters, {
    search: "technician",
    role: "worker",
    status: "active",
  });
  assert.deepEqual(parsed.query, {
    search: "technician",
    role: "worker",
    status: "active",
    afterCursor: "opaque-cursor",
    pageSize: WEBSITE_WORKERS_PAGE_SIZE,
  });
  assert.equal(
    buildCompanyWorkersApiPath(1001, parsed.query),
    "/api/v1/companies/1001/workers?search=technician&role=worker&status=active&pageSize=25&afterCursor=opaque-cursor",
  );
});

test("worker query helpers preserve filters in continuation links", () => {
  const filters = { search: "north", role: "user" as const, status: "pending" as const };
  assert.equal(
    buildWorkersPageHref(1001, filters, CursorSchema.parse("next-cursor")),
    "/app/c/1001/workers?search=north&role=user&status=pending&afterCursor=next-cursor",
  );
  assert.equal(hasActiveWorkersFilters(filters), true);
  assert.equal(hasActiveWorkersFilters({ search: "", role: "", status: "" }), false);
});

test("worker search params fail closed for duplicates and unknown filters", () => {
  assert.equal(parseWorkersSearchParams({ role: ["worker", "user"] }).ok, false);
  assert.equal(parseWorkersSearchParams({ role: "manager" }).ok, false);
  assert.equal(parseWorkersSearchParams({ status: "archived" }).ok, false);
  assert.equal(parseWorkersSearchParams({ search: "x".repeat(81) }).ok, false);
  assert.throws(() => buildCompanyWorkersApiPath(0, {}));
});
