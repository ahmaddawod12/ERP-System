import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocumentDownloadUrl,
  type DocumentDownloadUrlSigner,
} from "../src/storage.js";

test("document signing uses the exact GCS object and configured expiry", async () => {
  const calls: Array<{ objectPath: string; expiresAt: number }> = [];
  const signer: DocumentDownloadUrlSigner = {
    async sign(objectPath, expiresAt) {
      calls.push({ objectPath, expiresAt });
      return "https://storage.googleapis.com/smart-job-company-files/company/document.pdf"
        + "?X-Goog-Signature=test";
    },
  };
  const before = Date.now();
  const result = await createDocumentDownloadUrl({
    projectId: "smart-job-prod",
    bucket: "smart-job-company-files",
    signedUrlTtlSeconds: 300,
  }, "company/document.pdf", signer);

  assert.match(result, /^https:\/\/storage\.googleapis\.com\//);
  assert.equal(calls[0]?.objectPath, "company/document.pdf");
  assert.ok((calls[0]?.expiresAt ?? 0) >= before + 300_000);
});

test("document signing rejects traversal and unexpected URL schemes", async () => {
  const signer: DocumentDownloadUrlSigner = {
    async sign() {
      return "file:///private/document.pdf";
    },
  };
  const config = {
    bucket: "smart-job-company-files" as const,
    signedUrlTtlSeconds: 300,
  };
  await assert.rejects(
    createDocumentDownloadUrl(config, "../document.pdf", signer),
    /object path is invalid/,
  );
  await assert.rejects(
    createDocumentDownloadUrl(config, "company/document.pdf", signer),
    /unexpected URL/,
  );
});
