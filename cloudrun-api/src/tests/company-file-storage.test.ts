import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../http/errors.js";
import {
  createCompanyFileStorage,
  type StoredUploadAttachment,
} from "../storage/company-files.js";

const BASE_URL = new URL("https://project.supabase.co/");
const BUCKET_ID = "smart-job-company-files";
const SECRET_KEY = "sb_secret_storage_test_key_123456789012345";
const fileBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x76, 0x65, 0x72, 0x69,
  0x66, 0x69, 0x65, 0x64, 0xff, 0xd9,
]);
const invalidHashBytes = Buffer.from(fileBytes);
invalidHashBytes[15] = (invalidHashBytes[15] ?? 0) ^ 0x01;
const wrongContentBytes = Buffer.from(fileBytes);
wrongContentBytes.fill(0, 0, 3);
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

interface FakeBucket {
  createSignedUploadUrl(
    path: string,
    options?: { upsert: boolean },
  ): Promise<unknown>;
  createSignedUrl(path: string, expiresIn: number): Promise<unknown>;
  info(path: string): Promise<unknown>;
  remove(paths: string[]): Promise<unknown>;
}

function clientFor(bucket: FakeBucket): SupabaseClient {
  return {
    storage: {
      from(bucketId: string) {
        assert.equal(bucketId, BUCKET_ID);
        return bucket;
      },
    },
  } as unknown as SupabaseClient;
}

function unusedBucket(overrides: Partial<FakeBucket> = {}): FakeBucket {
  return {
    async createSignedUploadUrl() {
      throw new Error("createSignedUploadUrl was not expected");
    },
    async createSignedUrl() {
      throw new Error("createSignedUrl was not expected");
    },
    async info() {
      throw new Error("info was not expected");
    },
    async remove() {
      throw new Error("remove was not expected");
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

test("signed upload targets stay on the configured origin/path and require create-only headers", async () => {
  const calls: Array<{ path: string; options?: { upsert: boolean } }> = [];
  const expectedPath = `/storage/v1/object/upload/sign/${BUCKET_ID}/${attachment.objectPath}`;
  const storage = createCompanyFileStorage({
    baseUrl: BASE_URL,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async createSignedUploadUrl(path, options) {
        calls.push({ path, ...(options === undefined ? {} : { options }) });
        return {
          data: {
            path,
            token: "signed-token",
            signedUrl: `${BASE_URL.origin}${expectedPath}?token=signed-token`,
          },
          error: null,
        };
      },
    })),
  });

  const targets = await storage.createSignedUploadTargets([attachment]);

  assert.deepEqual(calls, [{ path: attachment.objectPath, options: { upsert: false } }]);
  assert.equal(new URL(targets[0]?.uploadUrl ?? "").origin, BASE_URL.origin);
  assert.equal(new URL(targets[0]?.uploadUrl ?? "").pathname, expectedPath);
  assert.deepEqual(targets[0]?.requiredHeaders, {
    "cache-control": "max-age=3600",
    "content-type": attachment.mimeType,
    "x-upsert": "false",
  });
});

test("signed downloads stay on the configured private bucket path", async () => {
  const objectPath = `${attachment.objectPath}.pdf`;
  const expectedPath = `/storage/v1/object/sign/${BUCKET_ID}/${objectPath}`;
  const calls: Array<{ path: string; expiresIn: number }> = [];
  const storage = createCompanyFileStorage({
    baseUrl: BASE_URL,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async createSignedUrl(path, expiresIn) {
        calls.push({ path, expiresIn });
        return {
          data: { signedUrl: `${BASE_URL.origin}${expectedPath}?token=download-token` },
          error: null,
        };
      },
    })),
  });

  assert.equal(
    await storage.createSignedDownloadUrl?.(objectPath, 900),
    `${BASE_URL.origin}${expectedPath}?token=download-token`,
  );
  assert.deepEqual(calls, [{ path: objectPath, expiresIn: 900 }]);
  await assert.rejects(
    storage.createSignedDownloadUrl!("../cross-tenant.pdf", 900),
    /Storage object path is invalid/,
  );
});

test("local signed URLs validate against the internal origin and return the public loopback origin", async () => {
  const internalBaseUrl = new URL("http://supabase_kong_smart-job-erp-local:8000/");
  const publicBaseUrl = new URL("http://127.0.0.1:55321/");
  const expectedPath = `/storage/v1/object/upload/sign/${BUCKET_ID}/${attachment.objectPath}`;
  const storage = createCompanyFileStorage({
    baseUrl: internalBaseUrl,
    publicBaseUrl,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async createSignedUploadUrl(path) {
        return {
          data: {
            path,
            token: "local-token",
            signedUrl: `${internalBaseUrl.origin}${expectedPath}?token=local-token`,
          },
          error: null,
        };
      },
    })),
  });

  const [target] = await storage.createSignedUploadTargets([attachment]);
  assert.equal(target?.uploadUrl, `${publicBaseUrl.origin}${expectedPath}?token=local-token`);
});

test("signed upload targets reject malformed, cross-origin, and wrong-object URLs", async () => {
  const invalidUrls = [
    "not-a-url",
    `https://attacker.example${
      `/storage/v1/object/upload/sign/${BUCKET_ID}/${attachment.objectPath}`
    }?token=signed-token`,
    `${BASE_URL.origin}/storage/v1/object/upload/sign/other-bucket/wrong.jpg?token=signed-token`,
    `${BASE_URL.origin}/storage/v1/object/upload/sign/${BUCKET_ID}/${attachment.objectPath}`,
  ];

  for (const signedUrl of invalidUrls) {
    const storage = createCompanyFileStorage({
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async createSignedUploadUrl(path) {
          return {
            data: { path, token: "signed-token", signedUrl },
            error: null,
          };
        },
      })),
    });
    await assert.rejects(
      storage.createSignedUploadTargets([attachment]),
      assertAppError("STORAGE_UNAVAILABLE", 503),
    );
  }
});

test("unexpected Supabase Storage failures map to retryable service errors", async (context) => {
  await context.test("signed URL request", async () => {
    const storage = createCompanyFileStorage({
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async createSignedUploadUrl() {
          throw new TypeError("network failed");
        },
      })),
    });
    await assert.rejects(
      storage.createSignedUploadTargets([attachment]),
      (error: unknown) => assertAppError("STORAGE_UNAVAILABLE", 503)(error)
        && (error as AppError).retryable,
    );
  });

  await context.test("object info request", async () => {
    const storage = createCompanyFileStorage({
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async info() {
          throw new TypeError("network failed");
        },
      })),
    });
    await assert.rejects(
      storage.verifyUploadedAttachments([attachment]),
      (error: unknown) => assertAppError("STORAGE_UNAVAILABLE", 503)(error)
        && (error as AppError).retryable,
    );
  });

  await context.test("object cleanup request", async () => {
    const storage = createCompanyFileStorage({
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async remove() {
          throw new TypeError("network failed");
        },
      })),
    });
    await assert.rejects(
      storage.removeObjects([attachment.objectPath]),
      (error: unknown) => assertAppError("STORAGE_UNAVAILABLE", 503)(error)
        && (error as AppError).retryable,
    );
  });
});

test("uploaded attachment verification streams the exact private object and checks SHA-256", async () => {
  let requestedUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const storage = createCompanyFileStorage({
    baseUrl: BASE_URL,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async info(path) {
        assert.equal(path, attachment.objectPath);
        return {
          data: { size: fileBytes.length, contentType: "image/jpeg; charset=binary" },
          error: null,
        };
      },
    })),
    fetch: (async (input, init) => {
      requestedUrl = new URL(String(input));
      requestInit = init;
      return new Response(fileBytes, { status: 200 });
    }) as typeof globalThis.fetch,
  });

  await storage.verifyUploadedAttachments([attachment]);

  assert.equal(
    requestedUrl?.pathname,
    `/storage/v1/object/authenticated/${BUCKET_ID}/${attachment.objectPath}`,
  );
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.redirect, "error");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), SECRET_KEY);
  assert.equal(headers.get("authorization"), null);
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
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async info() {
          return { data: { size: body.length, contentType: mimeType }, error: null };
        },
      })),
      fetch: (async () => new Response(body, { status: 200 })) as typeof globalThis.fetch,
    });

    await storage.verifyUploadedAttachments([candidate]);
  }
});

test("uploaded attachment verification rejects size, MIME, and SHA mismatches", async () => {
  const scenarios = [
    {
      name: "metadata size",
      info: { size: fileBytes.length + 1, contentType: attachment.mimeType },
      body: fileBytes,
      expectedMessage: /unexpected size/i,
    },
    {
      name: "metadata MIME",
      info: { size: fileBytes.length, contentType: "image/png" },
      body: fileBytes,
      expectedMessage: /unexpected content type/i,
    },
    {
      name: "downloaded SHA",
      info: { size: fileBytes.length, contentType: attachment.mimeType },
      body: invalidHashBytes,
      expectedMessage: /integrity verification/i,
    },
    {
      name: "downloaded content",
      info: { size: fileBytes.length, contentType: attachment.mimeType },
      body: wrongContentBytes,
      expectedMessage: /declared content type/i,
    },
  ] as const;

  for (const scenario of scenarios) {
    let fetchCalls = 0;
    const candidate = attachment;
    const storage = createCompanyFileStorage({
      baseUrl: BASE_URL,
      bucketId: BUCKET_ID,
      secretKey: SECRET_KEY,
      client: clientFor(unusedBucket({
        async info() {
          return { data: scenario.info, error: null };
        },
      })),
      fetch: (async () => {
        fetchCalls += 1;
        return new Response(scenario.body, { status: 200 });
      }) as typeof globalThis.fetch,
    });

    await assert.rejects(
      storage.verifyUploadedAttachments([candidate]),
      (error: unknown) => assertAppError("UPLOAD_OBJECT_INVALID", 400)(error)
        && scenario.expectedMessage.test((error as Error).message),
    );
    assert.equal(
      fetchCalls,
      scenario.name === "metadata size" || scenario.name === "metadata MIME" ? 0 : 1,
    );
  }
});

test("missing upload objects return retryable 425 responses", async () => {
  const missingInfoStorage = createCompanyFileStorage({
    baseUrl: BASE_URL,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async info() {
        return { data: null, error: { statusCode: 404 } };
      },
    })),
  });
  await assert.rejects(
    missingInfoStorage.verifyUploadedAttachments([attachment]),
    (error: unknown) => assertAppError("UPLOAD_OBJECT_NOT_READY", 425)(error)
      && (error as AppError).retryable,
  );

  const missingDownloadStorage = createCompanyFileStorage({
    baseUrl: BASE_URL,
    bucketId: BUCKET_ID,
    secretKey: SECRET_KEY,
    client: clientFor(unusedBucket({
      async info() {
        return {
          data: { size: attachment.sizeBytes, contentType: attachment.mimeType },
          error: null,
        };
      },
    })),
    fetch: (async () => new Response(null, { status: 404 })) as typeof globalThis.fetch,
  });
  await assert.rejects(
    missingDownloadStorage.verifyUploadedAttachments([attachment]),
    (error: unknown) => assertAppError("UPLOAD_OBJECT_NOT_READY", 425)(error)
      && (error as AppError).retryable,
  );
});
