import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentDownloadUrl } from "../src/storage.js";

test("local storage signing keeps the private request internal and returns a browser URL", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({
      signedURL: "/storage/v1/object/sign/smart-job-company-files/company/document.pdf?token=local",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await createDocumentDownloadUrl({
      baseUrl: new URL("http://supabase_kong_smart-job-erp-local:8000"),
      publicBaseUrl: new URL("http://127.0.0.1:55321"),
      secretKey: "sb_secret_local",
      bucket: "smart-job-company-files",
      signedUrlTtlSeconds: 300,
    }, "company/document.pdf");
    assert.match(requested, /^http:\/\/supabase_kong_smart-job-erp-local:8000\/storage\/v1\/object\/sign\//);
    assert.equal(
      result,
      "http://127.0.0.1:55321/storage/v1/object/sign/smart-job-company-files/company/document.pdf?token=local",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
