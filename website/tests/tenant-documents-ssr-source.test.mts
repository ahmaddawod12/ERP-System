import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/documents/page.tsx");
const documentsList = readSource("../src/components/documents/documents-list.tsx");
const documentsFilters = readSource("../src/components/documents/documents-filters.tsx");
const documentsClient = readSource("../src/lib/backend/documents-client.ts");
const downloadRoute = readSource("../src/app/api/companies/[companyId]/documents/[documentId]/download/route.ts");

test("tenant documents render validated initial DTOs on the server", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.doesNotMatch(documentsList, /^\s*["']use client["']/m);
  assert.doesNotMatch(documentsFilters, /^\s*["']use client["']/m);
  assert.match(documentsClient, /DocumentListPageSchema/);
  assert.match(page, /documents=\{page\.items\}/);
  assert.match(documentsList, /documents\.map\(\(document\) =>/);
  assert.match(documentsList, /key=\{document\.documentId\}/);
});

test("forged tenant URLs are denied before the documents backend request", () => {
  const membershipCheck = page.indexOf("findViewerWorkspace(viewer.workspaces, companyId)");
  const membershipDenial = page.indexOf("if (!membership)");
  const documentsRequest = page.indexOf("await getCompanyDocuments(companyId, context.sessionToken, parsedSearch.query)");

  assert.notEqual(membershipCheck, -1);
  assert.notEqual(membershipDenial, -1);
  assert.notEqual(documentsRequest, -1);
  assert.ok(membershipCheck < membershipDenial);
  assert.ok(membershipDenial < documentsRequest);
  assert.match(page.slice(membershipDenial, documentsRequest), /notFound\(\)/);
});

test("document SSR and download links keep backend credentials out of the browser", () => {
  assert.match(documentsClient, /^import "server-only";/);
  assert.match(documentsClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.equal((page.match(/await getCompanyDocuments\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /fetch\(|useEffect|useQuery|useInfiniteQuery|BACKEND_API_BASE_URL/);
  assert.doesNotMatch(documentsList, /fetch\(|SmartJobSession|BACKEND_API_BASE_URL|sessionToken/);
  assert.doesNotMatch(documentsFilters, /fetch\(|SmartJobSession|BACKEND_API_BASE_URL|sessionToken/);
  assert.match(documentsList, /buildDocumentDownloadHref\(companyId, document\.documentId\)/);
  assert.match(downloadRoute, /handleDocumentDownload/);
  assert.doesNotMatch(downloadRoute, /NextResponse\.json|downloadURL|Authorization|SmartJobSession/);
});

test("documents expose filter, empty, disabled, error, and cursor states", () => {
  assert.match(documentsFilters, /method="get"/);
  assert.match(documentsFilters, /name="search"/);
  assert.match(documentsFilters, /name="status"/);
  assert.match(documentsFilters, /name="documentType"/);
  assert.match(documentsFilters, /name="dateFrom"/);
  assert.match(documentsFilters, /name="dateTo"/);
  assert.match(page, /InvalidDocumentsFilterState/);
  assert.match(page, /filters=\{emptyFilters\} disabled/);
  assert.match(documentsList, /No documents match these filters/);
  assert.match(documentsList, /rel="next"/);
  assert.match(documentsList, /aria-disabled="true"/);
  assert.doesNotMatch(page, /while\s*\(/);
});
