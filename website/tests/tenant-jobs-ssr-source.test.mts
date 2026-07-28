import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/jobs/page.tsx");
const jobsList = readSource("../src/components/jobs/jobs-list.tsx");
const jobsFilters = readSource("../src/components/jobs/jobs-filters.tsx");
const jobsClient = readSource("../src/lib/backend/jobs-client.ts");

test("tenant jobs page renders validated initial job DTOs on the server", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.doesNotMatch(jobsList, /^\s*["']use client["']/m);
  assert.match(jobsClient, /JobListPageSchema/);
  assert.match(page, /jobs=\{page\.items\}/);
  assert.match(jobsList, /jobs\.map\(\(job\) =>/);
  assert.match(jobsList, /\{job\.title\}/);
  assert.match(jobsList, /key=\{job\.jobId\}/);
});

test("forged tenant URLs are denied before the jobs backend request", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const jobsRequest = page.indexOf("await getCompanyJobs(companyId, context.sessionToken, parsedSearch.query)");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(jobsRequest, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < jobsRequest);
  assert.match(page.slice(membershipDenial, jobsRequest), /notFound\(\)/);
});

test("jobs use one server-only opaque-session request and never refetch after hydration", () => {
  assert.match(jobsClient, /^import "server-only";/);
  assert.match(jobsClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.equal((page.match(/await getCompanyJobs\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|useInfiniteQuery|BACKEND_API_BASE_URL/);
  assert.doesNotMatch(jobsList, /fetch\(|useEffect|useQuery|useInfiniteQuery|SmartJobSession/);
  assert.doesNotMatch(jobsFilters, /fetch\(|useEffect|useQuery|BACKEND_API_BASE_URL|SmartJobSession/);
});

test("the server slice exposes filter, empty, error, disabled, and cursor states", () => {
  assert.match(jobsFilters, /method="get"/);
  assert.match(jobsFilters, /name="status"/);
  assert.match(jobsFilters, /name="search"/);
  assert.match(jobsFilters, /name="dateFrom"/);
  assert.match(jobsFilters, /name="dateTo"/);
  assert.match(page, /InvalidJobsFilterState/);
  assert.match(page, /filters=\{emptyFilters\} disabled/);
  assert.match(jobsList, /No jobs match these filters/);
  assert.match(jobsList, /rel="next"/);
  assert.match(jobsList, /aria-disabled="true"/);
  assert.doesNotMatch(page, /while\s*\(/);
});
