import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const page = readSource("../src/app/app/c/[companyId]/documents/page.tsx");
const list = readSource("../src/components/documents/documents-list.tsx");
const composer = readSource("../src/components/documents/document-create-control.tsx");
const rowActions = readSource("../src/components/documents/document-row-actions.tsx");
const browserModel = readSource("../src/components/documents/document-mutation-model.ts");
const routeCore = readSource("../src/lib/documents/document-mutation-route-core.ts");
const backendClient = readSource("../src/lib/backend/documents-client.ts");

test("document mutations are focused client islands over opaque same-origin BFFs", () => {
  assert.doesNotMatch(page, /^\s*["']use client["']/m);
  assert.match(page, /<DocumentCreateControl/);
  assert.match(list, /<DocumentRowActions/);
  assert.match(composer, /^"use client";/);
  assert.match(rowActions, /^"use client";/);
  assert.match(browserModel, /X-SJ-CSRF/);
  assert.match(browserModel, /Idempotency-Key/);
  assert.match(routeCore, /request\.headers\.get\("origin"\) !== expectedOrigin/);
  assert.match(routeCore, /safeEqual\(csrfCookie, csrfHeader\)/);
  assert.match(backendClient, /Authorization: `SmartJobSession \$\{sessionToken\}`/);
  assert.doesNotMatch(composer, /SmartJobSession|BACKEND_API_BASE_URL|\/api\/v1\//);
  assert.doesNotMatch(rowActions, /SmartJobSession|BACKEND_API_BASE_URL|\/api\/v1\//);
});

test("generic composer and BFF fail closed for tax type 305 pending certification", () => {
  assert.match(composer, /documentType\.code !== DOC_TYPE\.TAX_INVOICE/);
  assert.match(composer, /unavailable pending Tax Authority certification/);
  assert.match(routeCore, /isTaxDocumentRequest/);
  assert.match(routeCore, /TAX_SUBMISSION_DISABLED/);
  assert.match(rowActions, /document\.documentType === DOC_TYPE\.TAX_INVOICE/);
});

test("delete remains role-gated and carries the current opaque entity version", () => {
  assert.match(page, /membership\.role === "manager" \|\| membership\.role === "dev"/);
  assert.match(list, /canDeleteDocuments/);
  assert.match(rowActions, /entityVersion: document\.entityVersion/);
  assert.match(rowActions, /DocumentDeleteRequestSchema\.parse/);
  assert.match(rowActions, /STALE_ENTITY_VERSION/);
});

test("task polling stays same-origin and validates every response", () => {
  assert.match(composer, /readWebsiteDocumentTask/);
  assert.match(browserModel, /createApiResponseSchema\(DocumentTaskSchema\)/);
  assert.match(browserModel, /\/api\/companies\/\$\{companyId\}\/document-tasks/);
  assert.doesNotMatch(browserModel, /\/api\/read-model|buildAuthedJsonHeaders|firebase/);
  assert.match(composer, /readPersistedDocumentMutation\(window\.sessionStorage/);
  assert.match(composer, /persistDocumentMutation\(window\.sessionStorage/);
  assert.match(composer, /Resuming the previously accepted document task/);
});
