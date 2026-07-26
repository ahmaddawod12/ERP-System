import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createArchiveStorage } from "../archives/archive-storage.js";
import { AppError } from "../http/errors.js";

const objectPath = "companies/42/archives/2026-06-j-s000001.json";
const generation = "123456789";
const bytes = Buffer.from(JSON.stringify([{ id: "job-1" }]), "utf8");
const checksum = createHash("sha256").update(bytes).digest("hex");

function tokenResponse() {
  return Response.json({
    access_token: "a".repeat(32),
    expires_in: 3600,
    token_type: "Bearer",
  });
}

test("archive storage fetches and verifies the exact recorded generation", async () => {
  const urls: URL[] = [];
  const storage = createArchiveStorage({
    bucket: "archive-bucket",
    fetchImplementation: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.hostname === "metadata.example.test") return tokenResponse();
      return new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
      });
    },
    metadataTokenUrl: "https://metadata.example.test/token",
    gcsApiBaseUrl: "https://storage.example.test",
  });

  const content = await storage.readVerifiedArchiveJsonByPath(
    "42",
    objectPath,
    generation,
    checksum,
  );

  assert.deepEqual(content?.items, [{ id: "job-1" }]);
  assert.equal(urls[1]?.searchParams.get("alt"), "media");
  assert.equal(urls[1]?.searchParams.get("generation"), generation);
});

test("archive storage rejects corrupted bytes before JSON parsing", async () => {
  const storage = createArchiveStorage({
    bucket: "archive-bucket",
    fetchImplementation: async (input) => (
      new URL(String(input)).hostname === "metadata.example.test"
        ? tokenResponse()
        : new Response(bytes, { status: 200 })
    ),
    metadataTokenUrl: "https://metadata.example.test/token",
    gcsApiBaseUrl: "https://storage.example.test",
  });

  await assert.rejects(
    storage.readVerifiedArchiveJsonByPath(
      "42",
      objectPath,
      generation,
      "0".repeat(64),
    ),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && error.code === "ARCHIVE_INTEGRITY_FAILURE",
  );
});

test("archive storage reports a missing exact generation as unavailable", async () => {
  const storage = createArchiveStorage({
    bucket: "archive-bucket",
    fetchImplementation: async (input) => (
      new URL(String(input)).hostname === "metadata.example.test"
        ? tokenResponse()
        : new Response(null, { status: 404 })
    ),
    metadataTokenUrl: "https://metadata.example.test/token",
    gcsApiBaseUrl: "https://storage.example.test",
  });

  assert.equal(await storage.readVerifiedArchiveJsonByPath(
    "42",
    objectPath,
    generation,
    checksum,
  ), null);
});
