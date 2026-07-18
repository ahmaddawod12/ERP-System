import assert from "node:assert/strict";
import test from "node:test";
import {
  DocumentDeleteResultSchema,
  DocumentTaskAcceptedSchema,
} from "@smart-job/api-contracts";
import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import {
  handleDocumentDelete,
  handleDocumentGenerate,
  handleDocumentPreview,
} from "../src/lib/documents/document-mutation-route-core.ts";
import {
  clearPersistedDocumentMutation,
  documentMutationKey,
  documentRequestFromComposer,
  persistDocumentMutation,
  readPersistedDocumentMutation,
  type PendingDocumentMutation,
} from "../src/components/documents/document-mutation-model.ts";

const origin = "http://localhost:3000";
const sessionToken = "S".repeat(43);
const csrfToken = "C".repeat(43);
const companyId = "42";
const documentId = "11111111-1111-4111-8111-111111111111";
const entityVersion = "ev1.MQ";
const requestBody = {
  documentType: 10,
  documentData: {
    client: { name: "Northwind Cooling", email: "dispatch@northwind.example" },
    items: [{ description: "Annual service", quantity: 1, price: 250 }],
    language: "en",
    date: "2026-07-14",
    notes: "Call before arrival",
  },
} as const;

interface MutationRequestOptions {
  readonly origin?: string;
  readonly csrfCookie?: string;
  readonly csrfHeader?: string;
  readonly session?: string | null;
  readonly idempotencyKey?: string | null;
}

function mutationRequest(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
  options: MutationRequestOptions = {},
) {
  const cookies = [
    options.session === null ? null : `sj_web_session=${options.session ?? sessionToken}`,
    `sj_csrf=${options.csrfCookie ?? csrfToken}`,
  ].filter(Boolean).join("; ");
  const headers = new Headers({
    origin: options.origin ?? origin,
    cookie: cookies,
    "x-sj-csrf": options.csrfHeader ?? csrfToken,
    "content-type": "application/json",
  });
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? "document-mutation-key-1234");
  }
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

test("document composer normalizes optional fields and retries keep one key", () => {
  const request = documentRequestFromComposer({
    documentType: 10,
    clientName: " Northwind Cooling ",
    clientEmail: " ",
    clientPhone: " +972500000000 ",
    clientAddress: " ",
    clientCity: " Haifa ",
    clientVatNumber: " ",
    language: "en",
    date: "2026-07-14",
    notes: " ",
    items: [{ description: " Service ", quantity: 1, price: 250 }],
  });
  assert.deepEqual(request, {
    documentType: 10,
    documentData: {
      client: {
        name: "Northwind Cooling",
        phone: "+972500000000",
        city: "Haifa",
      },
      items: [{ description: "Service", quantity: 1, price: 250 }],
      language: "en",
      date: "2026-07-14",
    },
  });

  const pending: { current: PendingDocumentMutation | null } = { current: null };
  const first = documentMutationKey(pending, "same-request");
  assert.equal(documentMutationKey(pending, "same-request"), first);
  assert.notEqual(documentMutationKey(pending, "changed-request"), first);
});

test("accepted browser document tasks survive reload until terminal reconciliation", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const accepted = DocumentTaskAcceptedSchema.parse({
    taskId: "preview-task-restored",
    status: "pending",
    documentId: null,
    documentCode: null,
    entityVersion: null,
  });

  persistDocumentMutation(storage, 42, "preview", {
    fingerprint: "same-preview",
    key: "document-preview-idempotency-key",
    accepted,
  }, 1234);
  assert.deepEqual(readPersistedDocumentMutation(storage, 42, "preview"), {
    version: 1,
    companyId: 42,
    action: "preview",
    fingerprint: "same-preview",
    idempotencyKey: "document-preview-idempotency-key",
    accepted,
    updatedAt: 1234,
  });
  clearPersistedDocumentMutation(storage, 42, "preview");
  assert.equal(readPersistedDocumentMutation(storage, 42, "preview"), null);
});

test("preview and generate BFFs enforce opaque boundaries and forward stable idempotency", async () => {
  const previewAccepted = DocumentTaskAcceptedSchema.parse({
    taskId: "preview-task-123",
    status: "pending",
    documentId: null,
    documentCode: null,
    entityVersion: null,
  });
  let previewCalls = 0;
  const previewResponse = await handleDocumentPreview(
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", requestBody),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async preview(resolvedCompanyId, input, token, key) {
        previewCalls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.deepEqual(input, requestBody);
        assert.equal(token, sessionToken);
        assert.equal(key, "document-mutation-key-1234");
        return { data: previewAccepted, backendRequestId: "backend-preview" };
      },
    },
  );
  assert.equal(previewResponse.status, 202);
  assert.equal(previewCalls, 1);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.data.taskId, "preview-task-123");
  assert.doesNotMatch(JSON.stringify(previewBody), new RegExp(sessionToken));

  const generated = DocumentTaskAcceptedSchema.parse({
    taskId: "generate-task-123",
    status: "queued",
    documentId,
    documentCode: "PP1-42",
    entityVersion,
  });
  let generateCalls = 0;
  const generateResponse = await handleDocumentGenerate(
    mutationRequest("/api/companies/42/document-tasks/generate", "POST", requestBody),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async generate(resolvedCompanyId, input, token, key) {
        generateCalls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.deepEqual(input, requestBody);
        assert.equal(token, sessionToken);
        assert.equal(key, "document-mutation-key-1234");
        return { data: generated, backendRequestId: "backend-generate" };
      },
    },
  );
  assert.equal(generateResponse.status, 202);
  assert.equal(generateCalls, 1);
  const generateBody = await generateResponse.json();
  assert.equal(generateBody.data.entityVersion, entityVersion);
  assert.doesNotMatch(JSON.stringify(generateBody), /SmartJobSession|access[_-]?token|refresh[_-]?token/i);
});

test("generic document task BFFs reject tax type 305 before backend access", async () => {
  const taxBody = { ...requestBody, documentType: 305 };
  let calls = 0;
  const preview = await handleDocumentPreview(
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", taxBody),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async preview(): Promise<never> {
        calls += 1;
        throw new Error("must not run");
      },
    },
  );
  const generate = await handleDocumentGenerate(
    mutationRequest("/api/companies/42/document-tasks/generate", "POST", taxBody),
    companyId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async generate(): Promise<never> {
        calls += 1;
        throw new Error("must not run");
      },
    },
  );
  assert.equal(preview.status, 503);
  assert.equal(generate.status, 503);
  assert.equal((await preview.json()).error.code, "TAX_SUBMISSION_DISABLED");
  assert.equal((await generate.json()).error.code, "TAX_SUBMISSION_DISABLED");
  assert.equal(calls, 0);
});

test("document BFFs fail closed at origin, CSRF, session, key, route, and body boundaries", async () => {
  let calls = 0;
  const dependencies = {
    websiteOrigin: origin,
    nodeEnv: "development",
    async preview(): Promise<never> {
      calls += 1;
      throw new Error("must not run");
    },
  } as const;
  const cases = [
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", requestBody, {
      origin: "https://attacker.invalid",
    }),
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", requestBody, {
      csrfHeader: "D".repeat(43),
    }),
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", requestBody, {
      session: null,
    }),
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", requestBody, {
      idempotencyKey: null,
    }),
  ];
  for (const request of cases) {
    const response = await handleDocumentPreview(request, companyId, dependencies);
    assert.ok(response.status === 400 || response.status === 401 || response.status === 403);
  }
  const invalidRoute = await handleDocumentPreview(
    mutationRequest("/api/companies/bad/document-tasks/preview", "POST", requestBody),
    "not-a-company",
    dependencies,
  );
  assert.equal(invalidRoute.status, 400);
  const invalidBody = await handleDocumentPreview(
    mutationRequest("/api/companies/42/document-tasks/preview", "POST", { documentType: 10 }),
    companyId,
    dependencies,
  );
  assert.equal(invalidBody.status, 400);
  assert.equal(calls, 0);
});

test("document delete BFF preserves opaque entity version and backend conflicts", async () => {
  const removed = DocumentDeleteResultSchema.parse({
    documentId,
    documentCode: "PP1-42",
    disposition: "deleted",
  });
  let calls = 0;
  const response = await handleDocumentDelete(
    mutationRequest(`/api/companies/42/documents/${documentId}`, "DELETE", { entityVersion }),
    companyId,
    documentId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async remove(resolvedCompanyId, resolvedDocumentId, input, token, key) {
        calls += 1;
        assert.equal(resolvedCompanyId, 42);
        assert.equal(resolvedDocumentId, documentId);
        assert.equal(input.entityVersion, entityVersion);
        assert.equal(token, sessionToken);
        assert.equal(key, "document-mutation-key-1234");
        return { data: removed, backendRequestId: "backend-delete" };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual((await response.json()).data, removed);

  const conflict = await handleDocumentDelete(
    mutationRequest(`/api/companies/42/documents/${documentId}`, "DELETE", { entityVersion }),
    companyId,
    documentId,
    {
      websiteOrigin: origin,
      nodeEnv: "development",
      async remove() {
        throw new BackendTransportError({
          status: 409,
          code: "STALE_ENTITY_VERSION",
          message: "The document changed before this request was applied.",
          requestId: "backend-delete-conflict",
          fieldErrors: { entityVersion: ["Reload the document and try again."] },
        });
      },
    },
  );
  assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json();
  assert.equal(conflictBody.error.code, "STALE_ENTITY_VERSION");
  assert.equal(conflictBody.meta.requestId, "backend-delete-conflict");
});
