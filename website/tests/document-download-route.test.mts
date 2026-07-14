import assert from "node:assert/strict";
import test from "node:test";
import { DocumentDownloadAccessSchema } from "@smart-job/api-contracts";
import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleDocumentDownload,
  type DocumentDownloadRouteDependencies,
} from "../src/lib/documents/document-download-route-core.ts";

const origin = "http://localhost:3000";
const companyId = "42";
const documentId = "11111111-1111-4111-8111-111111111111";
const sessionToken = "S".repeat(43);
const nowMs = Date.parse("2026-07-14T10:00:00.000Z");
const download = DocumentDownloadAccessSchema.parse({
  documentId,
  documentCode: "TI-305-42",
  downloadURL: "https://storage.example.test/private/document.pdf?signature=short-lived",
  expiresAt: "2026-07-14T10:15:00.000Z",
});

function downloadRequest(options: { session?: string | null } = {}) {
  const headers = new Headers();
  if (options.session !== null) {
    headers.set("cookie", `sj_web_session=${options.session ?? sessionToken}`);
  }
  return new Request(`${origin}/api/companies/${companyId}/documents/${documentId}/download`, {
    method: "GET",
    headers,
  });
}

test("download BFF forwards opaque auth server-side and returns only a no-store redirect", async () => {
  let calls = 0;
  const response = await handleDocumentDownload(
    downloadRequest(),
    companyId,
    documentId,
    {
      nodeEnv: "development",
      nowMs,
      async read(resolvedCompanyId, resolvedDocumentId, token) {
        calls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(resolvedDocumentId, documentId);
        assert.equal(token, sessionToken);
        return download;
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), download.downloadURL);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await response.text(), "");
  assert.doesNotMatch([...response.headers].flat().join(" "), new RegExp(sessionToken));
  assert.doesNotMatch([...response.headers].flat().join(" "), /access[_-]?token|refresh[_-]?token|SmartJobSession/i);
});

test("download BFF fails closed before backend access for missing session or invalid scope", async () => {
  let calls = 0;
  const dependencies: DocumentDownloadRouteDependencies = {
    nodeEnv: "development",
    nowMs,
    async read() {
      calls += 1;
      return download;
    },
  };

  const missingSession = await handleDocumentDownload(
    downloadRequest({ session: null }),
    companyId,
    documentId,
    dependencies,
  );
  assert.equal(missingSession.status, 401);
  assert.equal((await missingSession.json()).error.code, "SESSION_REQUIRED");

  const invalidCompany = await handleDocumentDownload(
    downloadRequest(),
    "not-a-company",
    documentId,
    dependencies,
  );
  assert.equal(invalidCompany.status, 400);

  const invalidDocument = await handleDocumentDownload(
    downloadRequest(),
    companyId,
    "not-a-document",
    dependencies,
  );
  assert.equal(invalidDocument.status, 400);
  assert.equal(calls, 0);
});

test("download BFF rejects mismatched, expired, and unsafe backend redirects", async () => {
  const cases = [
    { ...download, documentId: "22222222-2222-4222-8222-222222222222" },
    { ...download, expiresAt: "2026-07-14T09:59:59.000Z" },
    { ...download, downloadURL: "http://storage.example.test/document.pdf" },
    { ...download, downloadURL: "javascript:alert(1)" },
  ];

  for (const access of cases) {
    const response = await handleDocumentDownload(
      downloadRequest(),
      companyId,
      documentId,
      {
        nodeEnv: "development",
        nowMs,
        async read() {
          return access;
        },
      },
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "DOCUMENT_DOWNLOAD_INVALID");
  }
});

test("download BFF preserves safe backend errors without exposing the session", async () => {
  const response = await handleDocumentDownload(
    downloadRequest(),
    companyId,
    documentId,
    {
      nodeEnv: "development",
      nowMs,
      async read() {
        throw new BackendTransportError({
          status: 404,
          code: "DOCUMENT_NOT_FOUND",
          message: "Document not found.",
          requestId: "backend-download-not-found",
        });
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.error.code, "DOCUMENT_NOT_FOUND");
  assert.equal(body.meta.requestId, "backend-download-not-found");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /access[_-]?token|refresh[_-]?token/i);
});
