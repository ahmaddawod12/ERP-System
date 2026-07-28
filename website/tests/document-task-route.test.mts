import assert from "node:assert/strict";
import test from "node:test";
import { DocumentTaskSchema } from "@smart-job/api-contracts";
import { BackendTransportError } from "../src/lib/backend/transport-core.ts";
import { handleDocumentTaskRead } from "../src/lib/documents/document-task-route-core.ts";

const origin = "http://localhost:3000";
const sessionToken = "S".repeat(43);
const taskId = "task-123";
const task = DocumentTaskSchema.parse({
  taskId,
  taskType: "preview",
  status: "completed",
  documentId: null,
  previewURL: "https://storage.example.test/private-preview.pdf?signature=short-lived",
  downloadURL: null,
  pdfSize: 2048,
  error: null,
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:01:00.000Z",
});

function taskRequest(session: string | null = sessionToken) {
  const headers = new Headers();
  if (session) headers.set("cookie", `sj_web_session=${session}`);
  return new Request(`${origin}/api/companies/42/document-tasks/${taskId}`, { headers });
}

test("task BFF forwards only the opaque cookie server-side and returns a validated DTO", async () => {
  let calls = 0;
  const response = await handleDocumentTaskRead(taskRequest(), "42", taskId, {
    nodeEnv: "development",
    async read(companyId, resolvedTaskId, token) {
      calls += 1;
      assert.equal(companyId, 42);
      assert.equal(resolvedTaskId, taskId);
      assert.equal(token, sessionToken);
      return { data: task, backendRequestId: "backend-task-read" };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.deepEqual(body.data, task);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(sessionToken));
  assert.doesNotMatch(JSON.stringify(body), /SmartJobSession|access[_-]?token|refresh[_-]?token/i);
});

test("task BFF rejects invalid sessions and route scope before backend access", async () => {
  let calls = 0;
  const dependencies = {
    nodeEnv: "development",
    async read(): Promise<never> {
      calls += 1;
      throw new Error("must not run");
    },
  } as const;
  assert.equal((await handleDocumentTaskRead(taskRequest(null), "42", taskId, dependencies)).status, 401);
  assert.equal((await handleDocumentTaskRead(taskRequest(), "bad", taskId, dependencies)).status, 400);
  assert.equal((await handleDocumentTaskRead(taskRequest(), "42", "bad/task", dependencies)).status, 400);
  assert.equal(calls, 0);
});

test("task BFF rejects mismatched DTOs and preserves backend authorization errors", async () => {
  const mismatch = await handleDocumentTaskRead(taskRequest(), "42", taskId, {
    nodeEnv: "development",
    async read() {
      return { data: { ...task, taskId: "other-task" }, backendRequestId: "backend-mismatch" };
    },
  });
  assert.equal(mismatch.status, 500);

  const forbidden = await handleDocumentTaskRead(taskRequest(), "42", taskId, {
    nodeEnv: "development",
    async read() {
      throw new BackendTransportError({
        status: 403,
        code: "DOCUMENT_TASK_ACCESS_FORBIDDEN",
        message: "This document task is not available.",
        requestId: "backend-task-forbidden",
      });
    },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "DOCUMENT_TASK_ACCESS_FORBIDDEN");
});
