import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { ApiDatabaseRuntime, DatabaseQueryable, DatabaseQueryResult } from "../database/runtime.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  CLAIM_DOCUMENT_DISPATCH_SQL,
  COMPLETE_DOCUMENT_DISPATCH_SQL,
  RETRY_DOCUMENT_DISPATCH_SQL,
  dispatchPendingDocumentTasks,
} from "../documents/dispatch.js";
import { createPubSubDocumentTaskPublisher } from "../documents/pubsub-publisher.js";
import { registerInternalDocumentDispatchRoute } from "../routes/internal-document-dispatch.js";

const userId = "bc985a21-40e7-4d1b-b582-2dc9e415f01c";
const otherUserId = "e69d2107-28f8-42fa-bb9e-ad3ddbaa37cd";

function result<Row extends QueryResultRow>(rows: readonly unknown[]): DatabaseQueryResult<Row> {
  return { rowCount: rows.length, rows: rows as unknown as Row[] };
}

test("document dispatch claims leases, publishes once, and defers transient failures", async () => {
  let leaseToken = "";
  const completions: string[] = [];
  const retries: Array<{ taskKey: string; error: string; delay: number }> = [];
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
      if (text === CLAIM_DOCUMENT_DISPATCH_SQL) {
        leaseToken = String(values?.[0]);
        assert.match(leaseToken, /^[0-9a-f-]{36}$/i);
        assert.deepEqual(values?.slice(1), [2, 30, null]);
        return result<Row>([
          {
            task_key: "preview-task",
            task_type: "preview",
            user_id: userId,
            dispatch_attempt: 1,
          },
          {
            task_key: "generate-task",
            task_type: "generate",
            user_id: otherUserId,
            dispatch_attempt: 3,
          },
        ]);
      }
      if (text === COMPLETE_DOCUMENT_DISPATCH_SQL) {
        assert.equal(values?.[1], leaseToken);
        completions.push(String(values?.[0]));
        return result<Row>([{ completed: true }]);
      }
      if (text === RETRY_DOCUMENT_DISPATCH_SQL) {
        assert.equal(values?.[1], leaseToken);
        retries.push({
          taskKey: String(values?.[0]),
          error: String(values?.[2]),
          delay: Number(values?.[3]),
        });
        return result<Row>([{ deferred: true }]);
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const transactionUsers: string[] = [];
  const database: ApiDatabaseRuntime = {
    maxConnections: 5,
    async checkReadiness() {},
    async close() {},
    async withTransaction(context, work) {
      transactionUsers.push(context.userId);
      return work(transaction);
    },
  };
  const published: string[] = [];
  const dispatch = await dispatchPendingDocumentTasks(database, {
    async publish(taskType, payload) {
      published.push(`${taskType}:${String(payload.taskId)}`);
      if (taskType === "generate") throw new Error("temporary Pub/Sub outage");
    },
  }, { userId, limit: 2 });

  assert.deepEqual(dispatch, { claimed: 2, published: 1, deferred: 1 });
  assert.deepEqual(published, ["preview:preview-task", "generate:generate-task"]);
  assert.deepEqual(completions, ["preview-task"]);
  assert.equal(retries[0]?.taskKey, "generate-task");
  assert.match(retries[0]?.error ?? "", /temporary Pub\/Sub outage/);
  assert.ok((retries[0]?.delay ?? 0) >= 1 && (retries[0]?.delay ?? 0) <= 8);
  assert.deepEqual(transactionUsers, [userId, userId, otherUserId]);
});

test("Pub/Sub publisher uses Cloud Run metadata identity and caches its token", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.includes("metadata.google.internal")) {
      return new Response(JSON.stringify({
        access_token: "metadata-access-token-value-123456789",
        expires_in: 3600,
        token_type: "Bearer",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ messageIds: ["message-1"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const publisher = createPubSubDocumentTaskPublisher({
    projectId: "smart-job-prod",
    previewTopic: "document-preview",
    generateTopic: "document-generate",
  }, { fetchImplementation: fakeFetch, now: () => 1_000 });

  await publisher.publish("preview", { taskId: "preview-task" });
  await publisher.publish("generate", { taskId: "generate-task" });

  assert.equal(requests.filter((request) => request.url.includes("metadata.google.internal")).length, 1);
  const publishRequests = requests.filter((request) => request.url.includes("pubsub.googleapis.com"));
  assert.equal(publishRequests.length, 2);
  assert.match(publishRequests[0]?.url ?? "", /topics\/document-preview:publish$/);
  assert.match(publishRequests[1]?.url ?? "", /topics\/document-generate:publish$/);
  assert.equal(new Headers(publishRequests[0]?.init?.headers).get("authorization"), "Bearer metadata-access-token-value-123456789");
  const body = JSON.parse(String(publishRequests[0]?.init?.body));
  assert.deepEqual(JSON.parse(Buffer.from(body.messages[0].data, "base64").toString("utf8")), {
    taskId: "preview-task",
  });
  assert.deepEqual(body.messages[0].attributes, { taskType: "preview" });
});

test("Pub/Sub publisher can target only an explicitly supplied local adapter", async () => {
  const requests: string[] = [];
  const publisher = createPubSubDocumentTaskPublisher({
    projectId: "smart-job-local",
    previewTopic: "document-preview",
    generateTopic: "document-generate",
  }, {
    apiBaseUrl: new URL("http://local-platform-adapter:8090/"),
    metadataTokenUrl:
      "http://local-platform-adapter:8090/computeMetadata/v1/instance/service-accounts/default/token",
    fetchImplementation: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("computeMetadata")) {
        return new Response(JSON.stringify({
          access_token: "local-adapter-access-token-1234567890",
          expires_in: 3_600,
          token_type: "Bearer",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ messageIds: ["local-message"] }), { status: 200 });
    },
  });

  await publisher.publish("preview", { taskId: "preview-task" });
  assert.equal(
    requests[1],
    "http://local-platform-adapter:8090/v1/projects/smart-job-local/topics/document-preview:publish",
  );
});

test("internal drain requires service identity before claiming bounded work", async (context) => {
  const serviceContextId = "6359f14e-dae2-5f57-87b9-82fb2d34fd47";
  let verifiedHeader = "";
  const database: ApiDatabaseRuntime = {
    maxConnections: 1,
    async checkReadiness() {},
    async close() {},
    async withTransaction(transactionContext, work) {
      assert.equal(transactionContext.userId, serviceContextId);
      return work({
        async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
          assert.equal(text, CLAIM_DOCUMENT_DISPATCH_SQL);
          assert.deepEqual(values?.slice(1), [7, 30, null]);
          return result<Row>([]);
        },
      });
    },
  };
  const app = await buildApp({ config: loadConfig({}), logger: false });
  context.after(() => app.close());
  registerInternalDocumentDispatchRoute(app, {
    database,
    internalIdentityVerifier: {
      async verifyAuthorizationHeader(header) {
        verifiedHeader = String(header);
        return {
          subject: "123456789012345678901",
          email: "scheduler@example.iam.gserviceaccount.com",
          contextUserId: serviceContextId,
        };
      },
    },
    documentTaskPublisher: {
      async publish() { throw new Error("no tasks should be claimed"); },
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/document-dispatch/drain",
    headers: { authorization: "Bearer google-service-token" },
    payload: { limit: 7 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(verifiedHeader, "Bearer google-service-token");
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.json().data, { claimed: 0, published: 0, deferred: 0 });
});
