import test from "node:test";
import assert from "node:assert/strict";
import {
  CursorSchema,
  JobListQuerySchema,
} from "@smart-job/api-contracts";
import {
  WEBSITE_JOBS_PAGE_SIZE,
  buildCompanyJobsApiPath,
  buildJobsPageHref,
  parseJobsSearchParams,
} from "../src/lib/dal/jobs-query.ts";

test("job URL filters become bounded API query values", () => {
  const cursor = CursorSchema.parse("opaque-next-cursor");
  const result = parseJobsSearchParams({
    status: "waiting",
    search: "  boiler  ",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-13",
    afterCursor: cursor,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.filters, {
    status: "waiting",
    search: "boiler",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-13",
  });
  assert.deepEqual(result.query, {
    status: "waiting",
    search: "boiler",
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-13T23:59:59.999Z",
    afterCursor: cursor,
    pageSize: WEBSITE_JOBS_PAGE_SIZE,
  });
});

test("job filter parsing rejects duplicate, invalid date, and reversed ranges", () => {
  assert.equal(parseJobsSearchParams({ status: ["pending", "finished"] }).ok, false);
  assert.equal(parseJobsSearchParams({ dateFrom: "2026-02-30" }).ok, false);
  assert.equal(parseJobsSearchParams({
    dateFrom: "2026-07-14",
    dateTo: "2026-07-13",
  }).ok, false);
  assert.equal(parseJobsSearchParams({ search: "x".repeat(81) }).ok, false);
});

test("jobs backend path transports all supported filters and an opaque cursor", () => {
  const query = JobListQuerySchema.parse({
    status: ["pending", "waiting"],
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-13T23:59:59.999Z",
    creatorUid: "11111111-1111-4111-8111-111111111111",
    search: "heat pump",
    pageSize: 25,
    afterCursor: "opaque+/cursor=",
  });
  const path = buildCompanyJobsApiPath(42, query);
  const url = new URL(path, "https://api.example.test");

  assert.equal(url.pathname, "/api/v1/companies/42/jobs");
  assert.deepEqual(url.searchParams.getAll("status"), ["pending", "waiting"]);
  assert.equal(url.searchParams.get("dateFrom"), "2026-07-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("dateTo"), "2026-07-13T23:59:59.999Z");
  assert.equal(url.searchParams.get("creatorUid"), "11111111-1111-4111-8111-111111111111");
  assert.equal(url.searchParams.get("search"), "heat pump");
  assert.equal(url.searchParams.get("pageSize"), "25");
  assert.equal(url.searchParams.get("afterCursor"), "opaque+/cursor=");
});

test("next-page links preserve public filters without carrying credentials", () => {
  const href = buildJobsPageHref(
    42,
    {
      status: "finished",
      search: "annual service",
      dateFrom: "2026-01-01",
      dateTo: "2026-07-13",
    },
    CursorSchema.parse("opaque-cursor"),
  );
  const url = new URL(href, "https://website.example.test");

  assert.equal(url.pathname, "/app/c/42/jobs");
  assert.equal(url.searchParams.get("status"), "finished");
  assert.equal(url.searchParams.get("search"), "annual service");
  assert.equal(url.searchParams.get("afterCursor"), "opaque-cursor");
  assert.doesNotMatch(href, /token|authorization|session/i);
});
