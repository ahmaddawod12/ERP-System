import assert from "node:assert/strict";
import test from "node:test";
import {
  CursorSchema,
  DocumentListQuerySchema,
} from "@smart-job/api-contracts";
import {
  WEBSITE_DOCUMENTS_PAGE_SIZE,
  buildCompanyDocumentsApiPath,
  buildDocumentDownloadHref,
  buildDocumentsPageHref,
  parseDocumentsSearchParams,
} from "../src/lib/dal/documents-query.ts";

test("document URL filters become bounded API query values", () => {
  const cursor = CursorSchema.parse("opaque-next-cursor");
  const result = parseDocumentsSearchParams({
    search: "  Northwind  ",
    status: "completed",
    documentType: "305",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    afterCursor: cursor,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.filters, {
    search: "Northwind",
    status: "completed",
    documentType: "305",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
  });
  assert.deepEqual(result.query, {
    search: "Northwind",
    status: "completed",
    documentType: 305,
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-14T23:59:59.999Z",
    pageSize: WEBSITE_DOCUMENTS_PAGE_SIZE,
    afterCursor: cursor,
  });
});

test("document filter parsing rejects duplicate, invalid, and reversed values", () => {
  assert.equal(parseDocumentsSearchParams({ status: ["pending", "completed"] }).ok, false);
  assert.equal(parseDocumentsSearchParams({ documentType: "999" }).ok, false);
  assert.equal(parseDocumentsSearchParams({ dateFrom: "2026-02-30" }).ok, false);
  assert.equal(parseDocumentsSearchParams({
    dateFrom: "2026-07-15",
    dateTo: "2026-07-14",
  }).ok, false);
  assert.equal(parseDocumentsSearchParams({ search: "x".repeat(81) }).ok, false);
});

test("documents backend path transports all SQL-backed filters and opaque cursor", () => {
  const query = DocumentListQuerySchema.parse({
    search: "Northwind",
    status: ["queued", "processing"],
    documentType: [10, 305],
    createdByUid: "11111111-1111-4111-8111-111111111111",
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-14T23:59:59.999Z",
    pageSize: 25,
    afterCursor: "opaque+/cursor=",
  });
  const path = buildCompanyDocumentsApiPath(42, query);
  const url = new URL(path, "https://api.example.test");

  assert.equal(url.pathname, "/api/v1/companies/42/documents");
  assert.equal(url.searchParams.get("search"), "Northwind");
  assert.deepEqual(url.searchParams.getAll("status"), ["queued", "processing"]);
  assert.deepEqual(url.searchParams.getAll("documentType"), ["10", "305"]);
  assert.equal(url.searchParams.get("createdByUid"), "11111111-1111-4111-8111-111111111111");
  assert.equal(url.searchParams.get("dateFrom"), "2026-07-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("dateTo"), "2026-07-14T23:59:59.999Z");
  assert.equal(url.searchParams.get("pageSize"), "25");
  assert.equal(url.searchParams.get("afterCursor"), "opaque+/cursor=");
});

test("document page and download links preserve tenant scope without credentials", () => {
  const href = buildDocumentsPageHref(
    42,
    {
      search: "annual service",
      status: "completed",
      documentType: "400",
      dateFrom: "2026-01-01",
      dateTo: "2026-07-14",
    },
    CursorSchema.parse("opaque-cursor"),
  );
  const url = new URL(href, "https://website.example.test");

  assert.equal(url.pathname, "/app/c/42/documents");
  assert.equal(url.searchParams.get("documentType"), "400");
  assert.equal(url.searchParams.get("afterCursor"), "opaque-cursor");
  assert.equal(
    buildDocumentDownloadHref(42, "11111111-1111-4111-8111-111111111111"),
    "/api/companies/42/documents/11111111-1111-4111-8111-111111111111/download",
  );
  assert.doesNotMatch(href, /authorization|access[_-]?token|refresh[_-]?token|session/i);
});
