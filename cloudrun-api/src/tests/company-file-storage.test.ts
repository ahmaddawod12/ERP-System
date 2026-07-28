import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";

import { AppError } from "../http/errors.js";
import {
  createCompanyFileStorage,
  type CompanyFileObjectStore,
  type StoredUploadAttachment,
} from "../storage/company-files.js";

const BUCKET_ID = "smart-job-company-files";
const NOW = Date.UTC(2026, 6, 28, 12);
const fileBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x76, 0x65, 0x72, 0x69,
  0x66, 0x69, 0x65, 0x64, 0xff, 0xd9,
]);
const attachment: StoredUploadAttachment = {
  attachmentId: "b1448e2d-4d9f-462f-8564-6d453be3b759",
  kind: "photo",
  fileName: "field-photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: fileBytes.length,
  sha256: createHash("sha256").update(fileBytes).digest("hex"),
  objectPath:
    "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/session/photo.jpg",
};

function unusedStore(
  overrides: Partial<CompanyFileObjectStore> = {},
): CompanyFileObjectStore {
  return {
    async checkReadiness() {
      throw new Error("checkReadiness was not expected");
    },
    async createSignedUploadUrl() {
      throw new Error("createSignedUploadUrl was not expected");
    },
    async getMetadata() {
      throw new Error("getMetadata was not expected");
    },
    createReadStream() {
      throw new Error("createReadStream was not expected");
    },
    async createSignedDownloadUrl() {
      throw new Error("createSignedDownloadUrl was not expected");
    },
    async removeObject() {
      throw new Error("removeObject was not expected");
    },
    ...overrides,
  };
}

function assertAppError(
  code: string,
  statusCode: number,
): (error: unknown) => boolean {
  return (error) => error instanceof AppError
    && error.code === code
    && error.statusCode === statusCode;
}

test("signed upload targets preserve create-only GCS URLs and required headers", async () => {
  const calls: unknown[] = [];
  const objectStore = unusedStore({
    async createSignedUploadUrl(input) {
      calls.push(input);
      return `https://storage.googleapis.com/${BUCKET_ID}/${attachment.objectPath}`
        + "?ifGenerationMatch=0&X-Goog-Signature=test";
    },
  });
  const storage = createCompanyFileStorage({
    bucketId: BUCKET_ID,
    objectStore,
    now: () => NOW,
  });

  const targets = await storage.createSignedUploadTargets([attachment]);

  assert.deepEqual(calls, [{
    objectPath: attachment.objectPath,
    contentType: attachment.mimeType,
    expiresAt: NOW + 600_000,
  }]);
  assert.equal(
    targets[0]?.uploadUrl,
    `https://storage.googleapis.com/${BUCKET_ID}/${attachment.objectPath}`
      + "?ifGenerationMatch=0&X-Goog-Signature=test",
  );
  assert.deepEqual(targets[0]?.requiredHeaders, {
    "cache-control": "private, max-age=3600",
    "content-type": attachment.mimeType,
  });
});

test("signed downloads validate object paths and bounded expirations", async () => {
  const calls: unknown[] = [];
  const objectStore = unusedStore({
    async createSignedDownloadUrl(input) {
      calls.push(input);
      return `https://storage.googleapis.com/${BUCKET_ID}/${input.objectPath}`
        + "?X-Goog-Signature=download";
    },
  });
  const storage = createCompanyFileStorage({
    bucketId: BUCKET_ID,
    objectStore,
    now: () => NOW,
  });

  assert.match(
    await storage.createSignedDownloadUrl!(attachment.objectPath, 900),
    /X-Goog-Signature=download$/,
  );
  assert.deepEqual(calls, [{
    objectPath: attachment.objectPath,
    expiresAt: NOW + 900_000,
  }]);
  await assert.rejects(
    storage.createSignedDownloadUrl!("../cross-tenant.pdf", 900),
    /Storage object path is invalid/,
  );
  await assert.rejects(
    storage.createSignedDownloadUrl!(attachment.objectPath, 10),
    /between 60 seconds and one hour/,
  );
});

test("uploaded attachment verification streams bytes and checks MIME plus SHA-256", async () => {
  const reads: string[] = [];
  const storage = createCompanyFileStorage({
    bucketId: BUCKET_ID,
    objectStore: unusedStore({
      async getMetadata(objectPath) {
        assert.equal(objectPath, attachment.objectPath);
        return {
          sizeBytes: fileBytes.length,
          contentType: "image/jpeg; charset=binary",
        };
      },
      createReadStream(objectPath) {
        reads.push(objectPath);
        return Readable.from([fileBytes.subarray(0, 10), fileBytes.subarray(10)]);
      },
    }),
  });

  await storage.verifyUploadedAttachments([attachment]);
  assert.deepEqual(reads, [attachment.objectPath]);
});

test("uploaded attachment verification recognizes every allowed image format", async () => {
  const samples = [
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    ["image/webp", Buffer.from("RIFF0000WEBPpayload", "ascii")],
    ["image/heic", Buffer.from("0000ftypheic0000heic", "ascii")],
    ["image/heif", Buffer.from("0000ftypmif10000mif1", "ascii")],
  ] as const;

  for (const [mimeType, body] of samples) {
    const candidate: StoredUploadAttachment = {
      ...attachment,
      mimeType,
      sizeBytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    const storage = createCompanyFileStorage({
      bucketId: BUCKET_ID,
      objectStore: unusedStore({
        async getMetadata() {
          return { sizeBytes: body.length, contentType: mimeType };
        },
        createReadStream() {
          return Readable.from([body]);
        },
      }),
    });

    await storage.verifyUploadedAttachments([candidate]);
  }
});

test("uploaded attachment verification rejects size, MIME, bytes, and SHA mismatches", async () => {
  const invalidHashBytes = Buffer.from(fileBytes);
  invalidHashBytes[15] = (invalidHashBytes[15] ?? 0) ^ 0x01;
  const wrongContentBytes = Buffer.from(fileBytes);
  wrongContentBytes.fill(0, 0, 3);
  const scenarios = [
    {
      metadata: { sizeBytes: fileBytes.length + 1, contentType: attachment.mimeType },
      body: fileBytes,
      expected: /unexpected size/i,
    },
    {
      metadata: { sizeBytes: fileBytes.length, contentType: "image/png" },
      body: fileBytes,
      expected: /unexpected content type/i,
    },
    {
      metadata: { sizeBytes: fileBytes.length, contentType: attachment.mimeType },
      body: invalidHashBytes,
      expected: /integrity verification/i,
    },
    {
      metadata: { sizeBytes: fileBytes.length, contentType: attachment.mimeType },
      body: wrongContentBytes,
      expected: /declared content type/i,
    },
  ] as const;

  for (const scenario of scenarios) {
    const storage = createCompanyFileStorage({
      bucketId: BUCKET_ID,
      objectStore: unusedStore({
        async getMetadata() {
          return scenario.metadata;
        },
        createReadStream() {
          return Readable.from([scenario.body]);
        },
      }),
    });
    await assert.rejects(
      storage.verifyUploadedAttachments([attachment]),
      (error: unknown) => assertAppError("UPLOAD_OBJECT_INVALID", 400)(error)
        && scenario.expected.test((error as Error).message),
    );
  }
});

test("missing upload objects return retryable 425 responses", async () => {
  const storage = createCompanyFileStorage({
    bucketId: BUCKET_ID,
    objectStore: unusedStore({
      async getMetadata() {
        return null;
      },
    }),
  });

  await assert.rejects(
    storage.verifyUploadedAttachments([attachment]),
    (error: unknown) => assertAppError("UPLOAD_OBJECT_NOT_READY", 425)(error)
      && (error as AppError).retryable,
  );
});

test("GCS readiness and cleanup failures map to retryable service errors", async () => {
  const cause = new Error("GCS unavailable");
  const storage = createCompanyFileStorage({
    bucketId: BUCKET_ID,
    objectStore: unusedStore({
      async checkReadiness() {
        throw cause;
      },
      async removeObject() {
        throw cause;
      },
    }),
  });

  await assert.rejects(
    storage.checkReadiness!(),
    (error: unknown) => assertAppError("STORAGE_UNAVAILABLE", 503)(error)
      && (error as AppError).retryable,
  );
  await assert.rejects(
    storage.removeObjects([attachment.objectPath]),
    (error: unknown) => assertAppError("STORAGE_UNAVAILABLE", 503)(error)
      && (error as AppError).retryable,
  );
});
